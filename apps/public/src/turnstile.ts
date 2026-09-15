/**
 * Cloudflare Turnstile 연결.
 *
 * 응모·투표 참여·투표 제출은 각각 다른 action으로 매번 새 token을 받는다.
 * token은 한 번만 쓸 수 있고 짧게 만료되므로 제출 직전에 실행한다.
 *
 * 개발 모드(site key가 mock)에서는 위젯을 띄우지 않고 mock token을 돌려준다.
 * 서버가 같은 mock 모드일 때만 통과하며, production 서버는 이 값을 받아들이지 않는다.
 */

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export type TurnstileAction = 'submission' | 'voter_session' | 'vote';

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      size: 'invisible';
      execution: 'execute';
      callback: (token: string) => void;
      'error-callback': (code?: string) => void;
      'timeout-callback'?: () => void;
    },
  ) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (scriptPromise !== null) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile !== undefined) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile === undefined) reject(new Error('보안 확인을 불러오지 못했습니다.'));
      else resolve(window.turnstile);
    };
    script.onerror = () => reject(new Error('보안 확인을 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export class TurnstileError extends Error {
  constructor(message = '보안 확인에 실패했습니다. 다시 시도해주세요.') {
    super(message);
    this.name = 'TurnstileError';
  }
}

export function isMockSiteKey(siteKey: string): boolean {
  return siteKey.length === 0 || siteKey.startsWith('mock');
}

const MOCK_TOKEN: Readonly<Record<TurnstileAction, string>> = {
  submission: 'mock-submission',
  voter_session: 'mock-voter_session',
  vote: 'mock-vote',
};

const TIMEOUT_MS = 30_000;

/**
 * action에 맞는 새 token을 하나 받는다.
 * 위젯은 보이지 않게 띄우고 이 함수가 끝나면 정리한다. 같은 token을 다시 쓰지 않는다.
 */
export async function getTurnstileToken(siteKey: string, action: TurnstileAction): Promise<string> {
  if (isMockSiteKey(siteKey)) return MOCK_TOKEN[action];

  const api = await loadScript().catch(() => {
    scriptPromise=null;
    throw new TurnstileError('보안 확인을 불러오지 못했습니다. 네트워크를 확인해주세요.');
  });

  const container = document.createElement('div');
  container.setAttribute('aria-hidden','true');
  document.body.appendChild(container);

  let widgetId: string | null = null;
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new TurnstileError('보안 확인이 시간 안에 끝나지 않았습니다. 다시 시도해주세요.'));
      }, TIMEOUT_MS);

      const finish = (fn: () => void) => {
        window.clearTimeout(timer);
        fn();
      };

      widgetId = api.render(container, {
        sitekey: siteKey,
        action,
        size: 'invisible',
        execution: 'execute',
        callback: (token: string) => finish(() => resolve(token)),
        'error-callback': (code) => {if(code&&/^\d+$/.test(code))console.warn('Turnstile error code:',code);finish(() => reject(new TurnstileError()));},
        'timeout-callback': () =>
          finish(() => reject(new TurnstileError('보안 확인이 만료되었습니다. 다시 시도해주세요.'))),
      });
      api.execute(widgetId);
    });
  } finally {
    if (widgetId !== null) {
      try {
        api.remove(widgetId);
      } catch {
        // 이미 정리된 경우는 무시한다.
      }
    }
    container.remove();
  }
}
