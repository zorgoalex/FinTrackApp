export const PASSWORD_POLICY_MESSAGE = 'Пароль должен содержать не менее 8 символов, строчную и заглавную латинские буквы и цифру';

export function isStrongPassword(password) {
  return typeof password === 'string'
    && password.length >= 8
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password);
}
