module.exports = async function before() {
  const { addPdasVisitor } = require('@codama/visitors');
  const {
    constantPdaSeedNode,
    stringTypeNode,
    stringValueNode,
    variablePdaSeedNode,
    publicKeyTypeNode,
  } = require('@codama/nodes');

  return addPdasVisitor({
    qs_bridge: [
      {
        name: 'globalState',
        seeds: [constantPdaSeedNode(stringTypeNode('utf8'), stringValueNode('global_state'))],
      },
            {
        name: 'pauser',
        seeds: [constantPdaSeedNode(stringTypeNode('utf8'), stringValueNode('pauser')), variablePdaSeedNode('pauser', publicKeyTypeNode())],
      },
    ],
  });
};


