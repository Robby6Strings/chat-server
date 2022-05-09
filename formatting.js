const userNameStart = '{{';
const userNameEnd = '}}';

const encodeName = (name) => userNameStart + name + userNameEnd;

module.exports = {
  encodeName,
};
