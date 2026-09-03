import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // 存量代码分诊(2026-09-03):这批规则降 warn 不拦 CI,新增代码也应避免
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    ignores: [".next/**", ".open-next/**", ".wrangler/**", "node_modules/**"],
  },
];

export default eslintConfig;
