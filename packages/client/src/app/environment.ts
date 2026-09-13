export type EnvironmentCheck = 'ok' | 'insecure-context' | 'webrtc-unsupported';

/** Часть Window, от которой зависит проверка; позволяет подменить окружение в тестах. */
export interface EnvironmentWindow {
  isSecureContext: boolean;
  RTCPeerConnection?: unknown;
  navigator: { mediaDevices?: { getUserMedia?: unknown } };
}

/**
 * Порядок проверок важен: на http://192.168.x.x `navigator.mediaDevices` равен undefined,
 * и без первой проверки пользователь увидел бы ложное «WebRTC не поддерживается»
 * вместо «Откройте по HTTPS».
 */
export function checkEnvironment(win: EnvironmentWindow = window): EnvironmentCheck {
  if (!win.isSecureContext) return 'insecure-context';
  if (
    typeof win.RTCPeerConnection !== 'function' ||
    typeof win.navigator.mediaDevices?.getUserMedia !== 'function'
  ) {
    return 'webrtc-unsupported';
  }
  return 'ok';
}
