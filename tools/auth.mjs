import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const hashPassword = (password, salt = randomBytes(16).toString('hex')) => ({
  salt,
  hash: scryptSync(password, salt, 64).toString('hex'),
});

export function checkPassword(password, { salt, hash }) {
  const got = scryptSync(password, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}
