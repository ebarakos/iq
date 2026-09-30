import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // .claude/ holds agent worktrees: full repo copies with their own build output.
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", ".claude/**"],
  },
];

export default eslintConfig;
