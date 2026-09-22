import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// Combinar las reglas recomendadas de Next.js con las restricciones propias del proyecto
const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      "no-undef": "error",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Permitir __dirname únicamente en los scripts CommonJS de despliegue
    files: ["**/*.cjs"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
      },
    },
  },
  // Excluir artefactos generados para que el lint solo revise código mantenido
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
