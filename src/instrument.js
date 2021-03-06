// @flow

import {
  VAR_INSPECT,
  VAR_INTERP,
  VAR_MEMBER_OBJECT_INTERP,
  VAR_MEMBER_PROPERTY_INTERP,
} from './constants';

// Keep in mind
// https://github.com/latentflip/loupe/blob/master/lib/instrument-code.js
// https://github.com/istanbuljs/istanbuljs/blob/master/packages/istanbul-lib-instrument/src/visitor.js

type Path = any;
type Node = any;

const IGNORE = Symbol('IGNORE');

const isIgnored = (node: Node) => node.hasOwnProperty(IGNORE);

const isInstrumentFunction = (node: Node) => (
    node.type === 'CallExpression' &&
    node.callee &&
    node.callee.type === 'Identifier' &&
    node.callee.name === VAR_INSPECT
  );

const isInstrumentIdentifier = (node: Node): boolean => (
    node.type === 'Identifier' && node.name === VAR_INSPECT
  );

const isInstrumented = (node: Node): boolean => {
  return isIgnored(node) || isInstrumentFunction(node) || isInstrumentIdentifier(node);
};

function ignore(...nodes: Node[]) {
  for (let i = 0; i < nodes.length; i++) {
    nodes[i][IGNORE] = true;
  }

  return nodes[0];
}

export const isConsoleLog = (expr: Node) => {
  return (
    expr.type === 'CallExpression' &&
    expr.callee &&
    expr.callee.type === 'MemberExpression' &&
    expr.callee.object &&
    expr.callee.object.name === 'console' &&
    expr.callee.property &&
    expr.callee.property.name === 'log'
  );
};

export const isIdentifier =
  (expr: Node, name: string) =>
    (expr.type === 'Identifier' && expr.name === name);

export const isUndefined = (expr: Node) => isIdentifier(expr, 'undefined');
export const isNaN = (expr: Node) => isIdentifier(expr, 'NaN');

export const isSymbol = (node: Node) => (
    node.type === 'CallExpression' &&
    node.callee &&
    node.callee.name === 'Symbol'
  );

export const isCall = (node: Node) => node.type === 'CallExpression';

export const isUnaryVoid = (node: Node) => (node.type === 'UnaryExpression' && node.operator === 'void');

export const isLiteral = (node: Node) => {
  const { type } = node;

  return (
      type === 'NullLiteral'      ||
      type === 'StringLiteral'    ||
      type === 'ObjectExpression' ||
      type === 'ObjectLiteral'    ||
      type === 'ArrayExpression'  ||
      type === 'ArrayLiteral'     ||
      type === 'BooleanLiteral'   ||
      type === 'NumericLiteral'   ||
      type === 'Literal'          ||
      type === 'TemplateLiteral'  ||
      type === 'RegExpLiteral'    ||
      isUndefined(node)           ||
      isNaN(node)                 ||
      isSymbol(node)
    );
};

/**
 * Returns true if the node is a callable expression.
 */
export const isCallable = ({ type }: Node) => {
  return (
      type === 'ClassExpression'         ||
      type === 'FunctionExpression'      ||
      type === 'ArrowFunctionExpression'
    );
};

export class Insertion {

  id: number;
  node: {};
  context: string;
  type: string;

  constructor(id: number, node: { type: string }, context: string) {
    this.id = id;
    this.node = node;
    this.context = context;
    this.type = node.type;
  }

}






/**
 * Transforms an AST to track a minimal amount of expressions. This transform
 * attempts to insert as few insertions as possible for better performance.
 *
 * @param options.types - babel types
 * @param options.ast - An ast to traverse
 * @param options.traverse - The babel traverser function
 */
export const minimal = ({
    types: t,
    ast,
    traverse,
  }: {
    types: any,
    ast: Object,
    traverse: Function
  }) => {
  const insertions = [];

  let id = -1;

  const addInsertionPoint = (node: Node, isExpression=false, context: string) => {
    id += 1;

    insertions.push({
      type: node.type,
      context,
      isExpression,
      node,
      id,
    })

    return id;
  };

  const trackStatement = (node: Node, context: string) => {
    const insertionId = addInsertionPoint(node, false, context);
    const identifier = t.identifier(VAR_INSPECT);
    const number = t.numericLiteral(insertionId);
    const call = t.callExpression(identifier, [number]);
    const statement = t.expressionStatement(call);

    ignore(statement, call, identifier, number, call);

    return statement;
  };

  const track = (node: Node, forceSequence=false, context: string) => {
    const insertionId = addInsertionPoint(node, true, context);
    // console.log('is', node.type, isLiteral(node) || isCallable(node))

    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
      // Fixes an issue where a call expression that has an undeclared identifier
      // creates a stack trace with incorrect line/column
      const number = t.numericLiteral(0);
      const identifier = t.identifier(node.callee.name);

      node.callee = t.sequenceExpression([number, identifier]);

      ignore(node.callee, number, identifier);
    }

    if (forceSequence || isCallable(node)) {
      // Don't track these since it's redundant information
      return t.sequenceExpression([
        t.callExpression(t.identifier(VAR_INSPECT), [t.numericLiteral(insertionId)]),
        node,
      ]);
    } else {
      return t.callExpression(t.identifier(VAR_INSPECT), [t.numericLiteral(id), node]);
    }
  };

  const visitors = {

    // ConditionalExpression(path: Path) {
      // TODO:
      // trackSelf(path);
    // },

    ReturnStatement(path: Path) {
      if (path.node.argument != null) {
        path.node.argument = track(path.node.argument, false, 'ReturnStatement');
      } else {
        path.insertBefore(trackStatement(path.node, 'ReturnStatement'));
      }
    },

    BreakStatement(path: Path) {
      path.insertBefore(trackStatement(path.node, 'BreakStatement'));
    },

    ContinueStatement(path: Path) {
      path.insertBefore(trackStatement(path.node, 'ContinueStatement'));
    },

    ForStatement(path: Path) {
      if (path.node.test != null) {
        path.node.test = track(path.node.test, true, 'ForStatement.test');
      }

      if (path.node.update != null) {
        path.node.update = track(path.node.update, true, 'ForStatement.update');
      }
    },

    ForOfStatement(path: Path) {
      path.node.right = track(path.node.right, false, 'ForOfStatement');
    },

    DoWhileStatement(path: Path) {
      path.node.test = track(path.node.test, false, 'DoWhileStatement');
    },

    WhileStatement(path: Path) {
      path.node.test = track(path.node.test, true, 'WhileStatement');
    },

    IfStatement(path: Path) {
      path.node.test = track(path.node.test, true, 'IfStatement');
    },

    SwitchStatement(path: Path) {
      path.node.discriminant = track(path.node.discriminant, false, 'SwitchStatement');
    },

    SwitchCase(path: Path) {
      if (path.node.test != null) {
        path.node.test = track(path.node.test, false, 'SwitchCase');
      }
    },

    LogicalExpression(path: Path) {
      path.node.left = track(path.node.left, true, 'LogicalExpression');
      path.node.right = track(path.node.right, true, 'LogicalExpression');
    },

    ExpressionStatement(path: Path) {
      const node = path.node;
      const expr = node.expression;

      if (isConsoleLog(expr) || isIgnored(node)) {
        return;
      }

      ignore(node);

      // TODO: Maybe add a right side to insertions because `users = []` yields
      //       `users = [] // []` in lively-browser or maybe just don't track
      //       the expression?

      node.expression = track(expr, false, 'ExpressionStatement');
    },

    VariableDeclaration(path: Path) {
      if (path.parent.type === 'ForStatement') {
        return;
      }

      const node = path.node;
      const length = node.declarations.length;

      for (let i = 0; i < length; i++) {
        const declaration = node.declarations[i];
        const init = declaration.init;

        if (init != null) {
          declaration.init = track(init, false, 'VariableDeclaration');
        }
      }
    },

  };

  traverse(ast, visitors);

  return {
    insertions,
  };
};






/**
 * Transforms an AST to track all expressions. This is terribly bad for performance
 * and should only be used for small scripts where performance is not necessary.
 *
 * @param  {babel.types} options.types t
 * @param  {Object} options.ast
 * @param  {Function} options.traverse - The babel traverser function
 * @return {Object} Returns the insertions and bad loops
 */
export const thorough = ({
    types: t,
    ast,
    traverse,
  }: {
    types: any,
    ast: Object,
    traverse: Function
  }) => {
  const insertions: Array<Insertion> = [];

  let id = -1;

  const addInsertionPoint = (node: Node, context: string) => {
    id += 1;

    insertions.push(new Insertion(id, node, context));

    return id;
  };

  let lastLoc = null;

  /**
   * Wraps an expression in a notifier function and returns the
   * notifier function
   */
  const track = (node: Node, context: string): Node => {
    lastLoc = node && node.loc ? node.loc : lastLoc;

    // To make debugging easier
    // if (node == null) {
      // console.log(node, context)
      // console.log(lastLoc)
    // }

    // console.log(node.type)

    if (isInstrumented(node) || isIgnored(node)) {
      return node;
    }

    const insertionId = addInsertionPoint(node, context);


    if (node.type === 'CallExpression') {
      if (node.callee.type === 'MemberExpression') {
        // Fixes an issue where wrapping a member expression in a call function causes
        // `this` to be means

        const propertyInterpIdentifier = t.identifier(VAR_MEMBER_PROPERTY_INTERP);
        const objectInterpIdentifier = t.identifier(VAR_MEMBER_OBJECT_INTERP);

        // THINKME: Is it really necessary to pass on the arguments if we know it's not going
        //          to be a function?

        const objectAssignment         = t.assignmentExpression('=', objectInterpIdentifier, node.callee.object);
        const objectAssignmentProperty = t.memberExpression(objectAssignment, node.callee.property, node.callee.computed)
        const propertyAssignment       = t.assignmentExpression('=', propertyInterpIdentifier, objectAssignmentProperty);
        const interpCall               = t.callExpression(propertyInterpIdentifier, []);
        const memberIdentifier         = t.identifier('call');
        const member                   = t.memberExpression(propertyInterpIdentifier, memberIdentifier);
        const memberCall               = t.callExpression(member, [objectInterpIdentifier, ...node.arguments]);
        const unary                    = t.unaryExpression('typeof', propertyInterpIdentifier);
        const string                   = t.stringLiteral('function');
        const bin                      = t.binaryExpression('===', unary, string);
        const condition                = t.conditionalExpression(bin, memberCall, interpCall);

        const seq = t.sequenceExpression([propertyAssignment, condition])
        const paren = t.parenthesizedExpression(seq);

        ignore(
            string,
            member,
            memberCall,
            memberIdentifier,
            bin,
            unary,
            condition,
            paren,
            objectAssignmentProperty,
            objectAssignment,
            objectInterpIdentifier,
            propertyAssignment,
            propertyInterpIdentifier,
          );

        node = seq;
      } else {
        node.callee = track(node.callee, 'CallExpression');
      }
    } else if (node.type === 'UpdateExpression') {
      const identifier = t.identifier(VAR_INTERP);
      const assignment = t.assignmentExpression('=', identifier, node);
      const number = t.numericLiteral(1);

      const call = createInspectCall(
          node.prefix
            ? ignore(
              t.binaryExpression((node.operator === '--' ? '+' : '-'), identifier, number)
            )
            : identifier,
          insertionId
        );

      const seq = t.sequenceExpression([assignment, call]);

      ignore(node, seq, number, identifier, assignment);

      return seq;
    }

    return createInspectCall(node, insertionId);
  };

  const createInspectCall = (node: Node, insertionId: number) => {
    const name = t.identifier(VAR_INSPECT);
    const number = t.numericLiteral(insertionId);
    const call = t.callExpression(name, [number, node]);

    return ignore(call, name, number);
  };

  const trackProp =
    (prop: string) =>
      (path: Path): void => {
        return path.node[prop] = track(path.node[prop], path.node.type);
      };

  const trackRight = trackProp('right');
  const trackLeft = trackProp('left');
  const trackTest = trackProp('test');

  /**
   * Wraps an expression itself and checks the parent node that it
   * has not already been instrumented.
   */
  const trackSelf = (path: Path): Node => {
    if (!isInstrumented(path.parent)) {
      path.replaceWith(track(path.node, path.parent.type))

    }

    return path.node;
  };

  const trackArgument = (path: Path): Node => {
    if (path.node.argument != null && !isInstrumented(path.node.argument)) {
      path.node.argument = track(path.node.argument, path.node.type);

    }

    return path.node.argument;
  };

  const trackRightVisitor = (path: Path) => { trackRight(path); };
  const trackTestVisitor = (path: Path) => { trackTest(path); };
  const trackSelfVisitor = (path: Path) => { trackSelf(path); };

  const visitors = {

    Identifier(path) {
      if (path.isReferencedIdentifier()) {
        trackSelf(path);
      }
    },

    Literal(path: Path) {
      trackSelf(path);
    },

    ConditionalExpression(path: Path) {
      if (isIgnored(path.node)) {
        return;
      }

      path.node.test = track(path.node.test, 'ConditionalExpression.test');
      path.node.consequent = track(path.node.consequent, 'ConditionalExpression.consequent');
      path.node.alternate = track(path.node.alternate, 'ConditionalExpression.alternate');

      trackSelf(path);
    },

    NewExpression(path: Path) {
      for (let i = 0, length = path.node.arguments.length; i < length; i++) {
        path.node.arguments[i] = track(path.node.arguments[i], 'NewExpression.arguments');
      }

      trackSelf(path);
    },

    CallExpression(path: Path) {
      // We have to check here that we aren't instrumenting the notifier function
      if (!isInstrumentFunction(path.node)) {
        for (let i = 0, length = path.node.arguments.length; i < length; i++) {
          path.node.arguments[i] = track(path.node.arguments[i], 'CallExpression.arguments');
        }
      }

      trackSelf(path);
    },

    MemberExpression(path: Path) {
      if (path.node.computed) {
        path.node.property = track(path.node.property, 'MemberExpression.property');
      }

      path.node.object = track(path.node.object, 'MemberExpression.object');

      trackSelf(path);
    },

    ReturnStatement(path: Path) {
      trackArgument(path);
    },

    ObjectProperty(path: Path) {
      // ignore string literal object literal keys
      if (!path.node.computed) {
        ignore(path.node.key);
      }
    },

    ForStatement(path: Path) {
      if (path.node.test != null) {
        path.node.test = track(path.node.test, 'ForStatement.test');
      }

      if (path.node.update) {
        path.node.update = track(path.node.update, 'ForStatement.update');
      }
    },

    ForOfStatement: trackRightVisitor,

    DoWhileStatement: trackTestVisitor,

    WhileStatement: trackTestVisitor,

    IfStatement: trackTestVisitor,

    SwitchCase(path: Path) {
      if (path.node.test == null) {
        return;
      }

      trackTest(path);
    },

    SwitchStatement(path: Path) {
      path.node.discriminant = track(path.node.discriminant, 'SwitchStatement')
    },

    LogicalExpression(path: Path) {
      path.node.left = trackLeft(path);
      path.node.right = trackRight(path);

      trackSelf(path);
    },

    BinaryExpression(path: Path) {
      path.node.left = trackLeft(path);
      path.node.right = trackRight(path);

      trackSelf(path);
    },

    ClassExpression: trackSelfVisitor,

    UnaryExpression: trackSelfVisitor,

    UpdateExpression(path: Path) {
      trackSelf(path);
    },

    ThisExpression: trackSelfVisitor,

    FunctionExpression: trackSelfVisitor,

    ArrowFunctionExpression: trackSelfVisitor,

    ObjectExpression: trackSelfVisitor,

    AwaitExpression(path: Path) {
      trackArgument(path);
      trackSelf(path);
    },

    AssignmentExpression(path: Path) {
      path.node.right = track(path.node.right, path.node.type);

      ignore(path.node.left);
      trackSelf(path);
    },

    ArrayExpression(path: Path) {
      for (let i = 0; i < path.node.elements; i++) {
        path.node.elements[i] = track(path.node.elements, 'ArrayExpression.elements');
      }

      trackSelf(path);
    },

    VariableDeclaration(path: Path) {
      const node = path.node;
      const length = node.declarations.length;

      for (let i = 0; i < length; i++) {
        const declaration = node.declarations[i];
        const init = declaration.init;

        if (init != null) {
          declaration.init = track(init, 'VariableDeclaration');
        }
      }
    },

  };

  traverse(ast, visitors);

  return {
    insertions,
  };
};
