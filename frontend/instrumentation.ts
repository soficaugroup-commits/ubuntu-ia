export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resolveLlmEndpoint } = await import("@/lib/server/env");
  // Refuse de démarrer sans fournisseur d'embeddings. Sur Render, la clé
  // vient de l'environnement du service, pas du fichier .env local.
  resolveLlmEndpoint();
}
