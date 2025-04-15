import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { Logger, LogLevel } from '../../src/utils/logger.js';

describe('Logger', () => {
  // Store original console methods to restore after tests
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  // Mock console methods for testing
  let consoleLogMock: any;
  let consoleWarnMock: any;
  let consoleErrorMock: any;
  
  beforeEach(() => {
    // Mock all console methods before each test
    consoleLogMock = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnMock = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorMock = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Reset log prefix to default for most tests
    Logger.setLogPrefix('[MNEE SDK]');
  });
  
  afterEach(() => {
    // Reset log level and mocks after each test
    Logger.setLogLevel(LogLevel.INFO);
    jest.restoreAllMocks();
    
    // Restore original console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });
  
  describe('logLevel settings', () => {
    it('should set and get log level correctly', () => {
      Logger.setLogLevel(LogLevel.DEBUG);
      expect(Logger.getLogLevel()).toBe(LogLevel.DEBUG);
      
      Logger.setLogLevel(LogLevel.WARN);
      expect(Logger.getLogLevel()).toBe(LogLevel.WARN);
      
      Logger.setLogLevel(LogLevel.ERROR);
      expect(Logger.getLogLevel()).toBe(LogLevel.ERROR);
      
      Logger.setLogLevel(LogLevel.NONE);
      expect(Logger.getLogLevel()).toBe(LogLevel.NONE);
    });
  });
  
  describe('logPrefix settings', () => {
    it('should set log prefix correctly', () => {
      const testPrefix = '[TEST PREFIX]';
      Logger.setLogPrefix(testPrefix);
      
      const logger = new Logger('TestContext');
      logger.info('Test message');
      
      // Check that the prefix is included, not specific format
      expect(consoleLogMock).toHaveBeenCalled();
      const callArg = consoleLogMock.mock.calls[0][0];
      expect(callArg).toContain(testPrefix);
      expect(callArg).toContain('TestContext');
      expect(callArg).toContain('Test message');
      
      // Reset log prefix for other tests
      Logger.setLogPrefix('[MNEE SDK]');
    });
  });
  
  describe('debug logs', () => {
    it('should log debug messages when level is DEBUG', () => {
      Logger.setLogLevel(LogLevel.DEBUG);
      const logger = new Logger('TestContext');
      
      logger.debug('Debug message');
      
      // Check that debug was called with the right content
      expect(consoleLogMock).toHaveBeenCalled();
      const callArg = consoleLogMock.mock.calls[0][0];
      expect(callArg).toContain('[DEBUG]');
      expect(callArg).toContain('TestContext');
      expect(callArg).toContain('Debug message');
    });
    
    it('should not log debug messages when level is higher than DEBUG', () => {
      Logger.setLogLevel(LogLevel.INFO);
      const logger = new Logger('TestContext');
      
      logger.debug('Debug message');
      
      expect(consoleLogMock).not.toHaveBeenCalled();
    });
  });
  
  describe('info logs', () => {
    it('should log info messages when level is INFO or lower', () => {
      // Test with DEBUG level (lower than INFO)
      Logger.setLogLevel(LogLevel.DEBUG);
      const logger = new Logger('TestContext');
      
      logger.info('Info message');
      
      // Check format without being strict about prefix
      expect(consoleLogMock).toHaveBeenCalled();
      let callArg = consoleLogMock.mock.calls[0][0];
      expect(callArg).toContain('[INFO]');
      expect(callArg).toContain('TestContext');
      expect(callArg).toContain('Info message');
      
      // Reset and test with INFO level
      consoleLogMock.mockClear();
      Logger.setLogLevel(LogLevel.INFO);
      
      logger.info('Info message');
      
      expect(consoleLogMock).toHaveBeenCalled();
      callArg = consoleLogMock.mock.calls[0][0];
      expect(callArg).toContain('[INFO]');
      expect(callArg).toContain('TestContext');
      expect(callArg).toContain('Info message');
    });
    
    it('should not log info messages when level is higher than INFO', () => {
      Logger.setLogLevel(LogLevel.WARN);
      const logger = new Logger('TestContext');
      
      logger.info('Info message');
      
      expect(consoleLogMock).not.toHaveBeenCalled();
    });
  });
  
  describe('warn logs', () => {
    it('should log warn messages when level is WARN or lower', () => {
      // Test with INFO level (lower than WARN)
      Logger.setLogLevel(LogLevel.INFO);
      const logger = new Logger('TestContext');
      
      logger.warn('Warning message');
      
      expect(consoleWarnMock).toHaveBeenCalled();
      let callArg = consoleWarnMock.mock.calls[0][0];
      expect(callArg).toContain('[WARN]');
      expect(callArg).toContain('TestContext');
      expect(callArg).toContain('Warning message');
      
      // Reset and test with WARN level
      consoleWarnMock.mockClear();
      Logger.setLogLevel(LogLevel.WARN);
      
      logger.warn('Warning message');
      
      expect(consoleWarnMock).toHaveBeenCalled();
      callArg = consoleWarnMock.mock.calls[0][0];
      expect(callArg).toContain('[WARN]');
      expect(callArg).toContain('TestContext');
      expect(callArg).toContain('Warning message');
    });
    
    it('should not log warn messages when level is higher than WARN', () => {
      Logger.setLogLevel(LogLevel.ERROR);
      const logger = new Logger('TestContext');
      
      logger.warn('Warning message');
      
      expect(consoleWarnMock).not.toHaveBeenCalled();
    });
  });
  
  describe('error logs', () => {
    it('should log error messages when level is ERROR or lower', () => {
      // Test with WARN level (lower than ERROR)
      Logger.setLogLevel(LogLevel.WARN);
      const logger = new Logger('TestContext');
      
      logger.error('Error message');
      
      expect(consoleErrorMock).toHaveBeenCalled();
      let callArg = consoleErrorMock.mock.calls[0][0];
      expect(callArg).toContain('[ERROR]');
      expect(callArg).toContain('TestContext');
      expect(callArg).toContain('Error message');
      
      // Reset and test with ERROR level
      consoleErrorMock.mockClear();
      Logger.setLogLevel(LogLevel.ERROR);
      
      logger.error('Error message');
      
      expect(consoleErrorMock).toHaveBeenCalled();
      callArg = consoleErrorMock.mock.calls[0][0];
      expect(callArg).toContain('[ERROR]');
      expect(callArg).toContain('TestContext');
      expect(callArg).toContain('Error message');
    });
    
    it('should not log error messages when level is NONE', () => {
      Logger.setLogLevel(LogLevel.NONE);
      const logger = new Logger('TestContext');
      
      logger.error('Error message');
      
      expect(consoleErrorMock).not.toHaveBeenCalled();
    });
    
    it('should include error objects in the log', () => {
      Logger.setLogLevel(LogLevel.ERROR);
      const logger = new Logger('TestContext');
      const errorObj = new Error('Test error');
      
      logger.error('Error occurred:', errorObj);
      
      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('Error occurred:'),
        errorObj
      );
    });
  });
  
  describe('child loggers', () => {
    it('should create a child logger with the correct context', () => {
      const parentLogger = new Logger('Parent');
      const childLogger = parentLogger.createChild('Child');
      
      childLogger.info('Child logger message');
      
      expect(consoleLogMock).toHaveBeenCalled();
      const callArg = consoleLogMock.mock.calls[0][0];
      expect(callArg).toContain('[Parent:Child]');
      expect(callArg).toContain('Child logger message');
    });
  });
  
  describe('multiple arguments', () => {
    it('should handle multiple arguments in log methods', () => {
      Logger.setLogLevel(LogLevel.DEBUG);
      const logger = new Logger('TestContext');
      
      const obj1 = { name: 'test object' };
      const obj2 = [1, 2, 3];
      
      logger.debug('Debug with objects:', obj1, obj2);
      
      expect(consoleLogMock).toHaveBeenCalledWith(
        expect.stringContaining('Debug with objects:'),
        obj1,
        obj2
      );
    });
  });
});