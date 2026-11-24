import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('fs', () => ({ readFileSync: jest.fn() }));
// pool.ts creates its logger on import, which would load the full config.
jest.mock('../../utils/logger', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('dotenv', () => ({ config: jest.fn() }));

import { readFileSync } from 'fs';
import { buildSslOptions } from '../pool';

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

describe('buildSslOptions', () => {
  beforeEach(() => {
    mockReadFileSync.mockReset();
  });

  it('returns false when SSL is off', () => {
    expect(buildSslOptions({ ssl: false })).toBe(false);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('verifies the server certificate when SSL is on and no CA is set', () => {
    const options = buildSslOptions({ ssl: true });

    expect(options).toEqual({ rejectUnauthorized: true });
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('loads the CA file and keeps verification on when DB_SSL_CA is set', () => {
    mockReadFileSync.mockReturnValue('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n');

    const options = buildSslOptions({ ssl: true, sslCa: '/etc/ssl/db-ca.pem' });

    expect(mockReadFileSync).toHaveBeenCalledWith('/etc/ssl/db-ca.pem', 'utf8');
    expect(options).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n',
    });
  });

  it('fails loudly when the CA file cannot be read', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(() => buildSslOptions({ ssl: true, sslCa: '/missing/ca.pem' })).toThrow(
      'DB_SSL_CA file could not be read: /missing/ca.pem'
    );
  });
});
