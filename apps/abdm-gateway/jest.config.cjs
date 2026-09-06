/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts"],
  transform: {
    "^.+\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.spec.json" }],
  },
  testTimeout: 30000,
};
