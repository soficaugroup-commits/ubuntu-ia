import { describe, expect, it } from "vitest";
import { claimExecution, hashCharge, reviewProposedAction } from "@/lib/server/actions";
import { decidePermission, defaultMatrix } from "@/lib/server/permissions";

const now = new Date("2026-10-21T12:00:00.000Z");

describe("Matrice des droits", () => {
  const rows = defaultMatrix();

  it("autorise la lecture et exige une validation pour l'envoi", () => {
    expect(decidePermission({ role: "utilisateur", action: "messagerie.lire", rows })).toBe("autorise");
    expect(decidePermission({ role: "utilisateur", action: "messagerie.envoyer", rows })).toBe("validation_requise");
    expect(decidePermission({ role: "responsable", action: "itrack.mettre_a_jour", rows })).toBe("validation_requise");
    expect(decidePermission({ role: "administrateur", action: "fichiers.supprimer", rows })).toBe("interdit");
  });

  it("ignore une délégation expirée et relève un interdit encore délégué", () => {
    expect(
      decidePermission({
        role: "utilisateur",
        action: "fichiers.supprimer",
        rows,
        hasDelegation: true,
        delegationExpireAt: "2026-10-20T00:00:00.000Z",
        now,
      }),
    ).toBe("interdit");
    expect(
      decidePermission({
        role: "utilisateur",
        action: "fichiers.supprimer",
        rows,
        hasDelegation: true,
        delegationExpireAt: "2026-10-22T00:00:00.000Z",
        now,
      }),
    ).toBe("validation_requise");
  });

  it("laisse une action inconnue interdite", () => {
    expect(decidePermission({ role: "utilisateur", action: "teams.poster", rows })).toBe("interdit");
  });
});

describe("Circuit d'une action proposée", () => {
  const charge = { destinataire: "ada@ubuntu-grp.com", objet: "Note" };
  const snapshot = {
    statut: "proposee" as const,
    chargeHash: hashCharge(charge),
    expireAt: "2026-10-22T12:00:00.000Z",
  };

  it("refuse d'exécuter sans approbation, après expiration, deux fois, ou si la charge change", () => {
    expect(claimExecution(snapshot, charge, now).ok).toBe(false);
    const approved = reviewProposedAction(snapshot, "approuver", now);
    expect(approved.ok && approved.audit).toBe("Action approuvée.");
    if (!approved.ok) return;
    const ready = { ...snapshot, statut: approved.statut };
    expect(claimExecution(ready, { ...charge, objet: "Autre" }, now).ok).toBe(false);
    expect(claimExecution({ ...ready, expireAt: "2026-10-21T11:00:00.000Z" }, charge, now).ok).toBe(false);
    const done = claimExecution(ready, charge, now);
    expect(done.ok && done.audit).toBe("Action exécutée.");
    if (!done.ok) return;
    const twice = claimExecution({ ...ready, statut: done.statut }, charge, now);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error).toMatch(/déjà/);
  });

  it("enregistre un refus", () => {
    const refused = reviewProposedAction(snapshot, "refuser", now);
    expect(refused.ok && refused.statut).toBe("refusee");
    expect(refused.ok && refused.audit).toMatch(/refusée/);
  });
});
