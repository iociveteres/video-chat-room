/**
 * Инвариант I3 (TDD этапа 4 §3.2): треки в RTCPeerConnection меняются только через
 * RTCRtpSender.replaceTrack. addTrack/removeTrack вызывают ренеготиацию — второй offer и glare.
 *
 * Проверка по типу, а не по имени: MediaStream.addTrack/removeTrack (previewStream, remoteStream)
 * разрешены. Запрещено обращение к методу, объявленному в интерфейсе RTCPeerConnection
 * (в том числе у наследников и в объединениях типов). Требует typed linting.
 */
const FORBIDDEN = new Set(['addTrack', 'removeTrack']);
const OWNER = 'RTCPeerConnection';

function propertyName(node) {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal') return String(node.property.value);
  return null;
}

/** Метод объявлен в RTCPeerConnection — у самого типа, наследника или одного из членов union. */
function isDeclaredOnPeerConnection(checker, type, name) {
  const parts = type.isUnionOrIntersection() ? type.types : [type];
  return parts.some((part) => {
    const symbol = checker.getPropertyOfType(checker.getApparentType(part), name);
    return (symbol?.declarations ?? []).some(
      (declaration) => declaration.parent?.name?.text === OWNER,
    );
  });
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow RTCPeerConnection.addTrack/removeTrack (invariant I3)' },
    schema: [],
    messages: {
      forbidden:
        'RTCPeerConnection.{{name}} вызывает ренеготиацию (I3). Используйте RTCRtpSender.replaceTrack на фиксированных трансиверах.',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program || !services.esTreeNodeToTSNodeMap) {
      throw new Error('no-peer-connection-track-mutation requires typed linting');
    }
    const checker = services.program.getTypeChecker();

    return {
      MemberExpression(node) {
        const name = propertyName(node);
        if (!name || !FORBIDDEN.has(name)) return;
        const tsObject = services.esTreeNodeToTSNodeMap.get(node.object);
        if (isDeclaredOnPeerConnection(checker, checker.getTypeAtLocation(tsObject), name)) {
          context.report({ node: node.property, messageId: 'forbidden', data: { name } });
        }
      },
    };
  },
};
