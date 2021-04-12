const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: {
    main: ['./src/main.js'],
    db: ['./src/db.js']
  },
  devtool: 'inline-source-map',
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: 'src/index.html',
          to: ''
        },
        {
          from: 'src/db.html',
          to: ''
        },
        {
          from: 'src/db2.html',
          to: ''
        },
        {
          from: 'src/summary.html',
          to: ''
        },
      ],
    }),
  ],
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
  },
};
