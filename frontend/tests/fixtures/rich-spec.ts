import type { DocumentSpec } from "@/lib/server/document-spec";

const regions = ["Abidjan", "Dakar", "Douala", "Lomé", "Cotonou", "Bamako"];

export function richSpec(): DocumentSpec {
  const rows = Array.from({ length: 30 }, (_, index) => [
    `${regions[index % regions.length]} ${index + 1}`,
    String(1000 + index * 25),
    `${(5 + (index % 7) * 1.5).toFixed(1).replace(".", ",")} %`,
    `${String((index % 28) + 1).padStart(2, "0")}/03/2026`,
  ]);
  return {
    title: "Rapport d'activité du premier trimestre 2026",
    subtitle: "Synthèse pour le comité de direction",
    sections: [
      {
        title: "Contexte",
        level: 1,
        body: [
          "Le trimestre a été marqué par une hausse de l'activité dans toutes les filiales du groupe.",
          "Les équipes ont consolidé les procédures de reporting et harmonisé les indicateurs.",
        ],
        bullets: ["Croissance des volumes", "Stabilité des charges", "Recrutements ciblés"],
      },
      {
        title: "Résultats par filiale",
        level: 1,
        body: ["Le tableau suivant détaille les montants par filiale."],
        bullets: [],
        table: { headers: ["Filiale", "Montant", "Taux de marge", "Date de clôture"], rows },
      },
      {
        title: "Répartition du chiffre d'affaires",
        level: 2,
        body: ["La répartition reste équilibrée entre les principales places."],
        bullets: [],
        chart: {
          title: "Chiffre d'affaires par place",
          kind: "column",
          categories: ["Abidjan", "Dakar", "Douala", "Lomé"],
          series: [{ name: "CA (M FCFA)", values: [420, 310, 280, 190] }],
        },
      },
      {
        title: "Perspectives",
        level: 1,
        body: [
          "Le second trimestre verra le lancement de trois chantiers prioritaires. ".repeat(6).trim(),
        ],
        bullets: Array.from({ length: 9 }, (_, index) => `Action prioritaire numéro ${index + 1} à conduire avec les directions concernées`),
        numbered: ["Valider le budget", "Lancer les recrutements", "Mesurer les résultats"],
      },
    ],
    charts: [],
  };
}

export function shortSpec(): DocumentSpec {
  return {
    title: "Note brève",
    subtitle: "",
    sections: [{ title: "Objet", level: 1, body: ["Une seule partie."], bullets: [] }],
    charts: [],
  };
}
