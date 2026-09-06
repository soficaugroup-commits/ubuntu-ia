import Link from "next/link";
import { Surface } from "@/components/ui/Surface";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-4 py-16">
      <Surface elevation="raised" radius="card" className="p-8">
        <h1 className="text-2xl font-semibold text-content">Page introuvable</h1>
        <p className="mt-3 text-content-muted">
          Cette adresse n&apos;existe pas dans Ubuntu IA. Revenez à la conversation
          ou à la connexion.
        </p>
        <Link
          href="/"
          className="neo-bubble mt-6 inline-flex min-h-11 items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-inverse"
        >
          Retour à Ubuntu IA
        </Link>
      </Surface>
    </main>
  );
}
