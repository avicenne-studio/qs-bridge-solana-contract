module.exports = async function before() {
  const { addPdasVisitor } = require("@codama/visitors");
  const {
    constantPdaSeedNode,
    stringTypeNode,
    stringValueNode,
    variablePdaSeedNode,
    publicKeyTypeNode,
    bytesTypeNode,
    numberTypeNode,
  } = require("@codama/nodes");

  return addPdasVisitor({
    qs_bridge: [
      {
        name: "globalState",
        seeds: [
          constantPdaSeedNode(
            stringTypeNode("utf8"),
            stringValueNode("global_state")
          ),
        ],
      },
      {
        name: "pauser",
        seeds: [
          constantPdaSeedNode(
            stringTypeNode("utf8"),
            stringValueNode("pauser")
          ),
          variablePdaSeedNode("pauser", publicKeyTypeNode()),
        ],
      },
      {
        name: "oracle",
        seeds: [
          constantPdaSeedNode(
            stringTypeNode("utf8"),
            stringValueNode("oracle")
          ),
          variablePdaSeedNode("oracle", publicKeyTypeNode()),
        ],
      },
      {
        name: "outboundOrder",
        seeds: [
          constantPdaSeedNode(
            stringTypeNode("utf8"),
            stringValueNode("outbound_order")
          ),
          variablePdaSeedNode("networkOut", numberTypeNode("u32")),
          variablePdaSeedNode("nonce", bytesTypeNode()),
        ],
      },
      {
        name: "inboundOrder",
        seeds: [
          constantPdaSeedNode(
            stringTypeNode("utf8"),
            stringValueNode("inbound_order")
          ),
          variablePdaSeedNode("networkIn", numberTypeNode("u32")),
          variablePdaSeedNode("nonce", bytesTypeNode()),
        ],
      },
    ],
  });
};
