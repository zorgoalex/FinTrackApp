export const INTERNET_REQUIRED_MESSAGE = 'Для входа и работы требуется подключение к интернету';

export function isInternetAvailable(navigatorObject = globalThis.navigator) {
  return navigatorObject?.onLine !== false;
}
