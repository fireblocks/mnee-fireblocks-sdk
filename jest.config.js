export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest', 
      {
        useESM: true,
      }
    ],
  },
  // Fix the moduleNameMapper regex - this was the issue
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  // Make sure the test paths are correct
  testMatch: [
    "**/test/**/*.test.ts"
  ],
  setupFilesAfterEnv: ['./test/setup.ts'],
  transformIgnorePatterns: [
    "/node_modules/(?!(@bsv|js-1sat-ord))"
  ],
  // Add these for better module resolution
  modulePaths: [
    "<rootDir>"
  ]
};