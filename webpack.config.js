const path = require('path');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');

module.exports = {
  entry: {
    bundle: ['@babel/polyfill', './lib/index'],
    testing: ['./lib/testing.js'],
  },
  module: {
    rules: [
      { test: /\.js$/, exclude: /node_modules/, loader: 'babel-loader' }
    ]
  },
  output: {
    filename: '[name].js',
    path: path.join(__dirname, 'build'),
  },
  node: {
    fs: 'empty',
    module: 'empty',
  },
  plugins: [
    new BundleAnalyzerPlugin({
      analyzerMode: 'static',
      openAnalyzer: false,
    }),
  ],
};