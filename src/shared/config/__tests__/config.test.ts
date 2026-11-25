import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

// The config module calls dotenv when it is imported. Stub it so a developer's
// local .env can never leak into these tests.
jest.mock('dotenv', () => ({ config: jest.fn() }));

import { loadConfig } from '../index';

const ORIGINAL_ENV = process.env;

const VALID_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  SOURCE_ID: 'neotree-system',
  FACILITY_ID: 'test-facility',
  FACILITY_NAME: 'Test Facility',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_NAME: 'neotree',
  DB_USER: 'postgres',
  OPENHIM_BASE_URL: 'http://localhost:5001',
  OPENHIM_USERNAME: 'test@example.org',
  OPENHIM_PASSWORD: 'not-a-real-password',
  OPENHIM_CHANNEL_PATH: '/fhir',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef', // exactly 32 characters
};

describe('loadConfig', () => {
  beforeEach(() => {
    process.env = { ...VALID_ENV };
    // loadConfig reports validation failures on stderr; keep test output clean.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('accepts a valid environment and maps it onto the config', () => {
    const config = loadConfig();

    expect(config.nodeEnv).toBe('test');
    expect(config.database.port).toBe(5432);
    expect(config.database.ssl).toBe(false);
    expect(config.source.facilityId).toBe('test-facility');
    expect(config.openhim.baseUrl).toBe('http://localhost:5001');
    expect(config.security.encryptionKey).toHaveLength(32);
  });

  it('rejects an ENCRYPTION_KEY that is not exactly 32 characters', () => {
    process.env.ENCRYPTION_KEY = 'too-short';

    expect(() => loadConfig()).toThrow('Invalid configuration');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('security.encryptionKey')
    );
  });

  it('rejects an OPENHIM_BASE_URL that is not a URL', () => {
    process.env.OPENHIM_BASE_URL = 'not a url';

    expect(() => loadConfig()).toThrow('Invalid configuration');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('openhim.baseUrl'));
  });

  it('maps DB_SSL and DB_SSL_CA onto the database config', () => {
    process.env.DB_SSL = 'true';
    process.env.DB_SSL_CA = '/etc/ssl/db-ca.pem';

    const config = loadConfig();

    expect(config.database.ssl).toBe(true);
    expect(config.database.sslCa).toBe('/etc/ssl/db-ca.pem');
  });

  it('treats an empty DB_SSL_CA as unset', () => {
    process.env.DB_SSL_CA = '';

    expect(loadConfig().database.sslCa).toBeUndefined();
  });

  it('rejects a missing required value', () => {
    delete process.env.FACILITY_ID;

    expect(() => loadConfig()).toThrow('Invalid configuration');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('source.facilityId'));
  });
});
