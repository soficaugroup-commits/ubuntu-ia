"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { SoficauMark } from "@/components/brand/SoficauMark";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Surface } from "@/components/ui/Surface";
import { Tooltip } from "@/components/ui/Tooltip";
import { IconClose, IconMenu } from "@/components/ui/icons";
import { copy } from "@/content/fr";
import { useSession } from "@/lib/session";

type Props = {
  children: ReactNode;
};

type NavLink = { href: string; label: string; tip: string };

function NavLinks({
  pathname,
  links,
  onNavigate,
}: {
  pathname: string;
  links: NavLink[];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Navigation principale" className="flex flex-col gap-2 lg:flex-row">
      {links.map((link) => {
        const current =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Tooltip key={link.href} label={link.tip} className="w-full lg:w-auto">
            <Link
              href={link.href}
              aria-current={current ? "page" : undefined}
              onClick={onNavigate}
              className={`block rounded-full px-4 py-2 text-sm font-semibold ${
                current
                  ? "neo-pressed text-content"
                  : "text-content-muted hover:text-content"
              }`}
            >
              {link.label}
            </Link>
          </Tooltip>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: Props) {
  const pathname = usePathname();
  const { user, signOut } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!user) {
    return <div className="app-frame">{children}</div>;
  }

  const links: NavLink[] = [
    { href: "/chat", label: copy.nav.conversation, tip: copy.nav.tipConversation },
    ...(user.role === "administrateur"
      ? [{ href: "/admin", label: copy.nav.documents, tip: copy.nav.tipDocuments }]
      : []),
  ];

  const displayName =
    [user.prenom, user.nom].filter(Boolean).join(" ") || copy.nav.unnamed;
  const roleLabel =
    user.role === "administrateur" ? copy.nav.roleAdmin : copy.nav.roleUser;

  return (
    <div className="app-frame app-frame-locked flex min-h-0 flex-1 flex-col bg-canvas">
      <header className="shrink-0 px-3 py-3 sm:px-4 sm:py-4">
        <Surface
          elevation="raised"
          radius="card"
          className="mx-auto flex w-full max-w-7xl items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-5 sm:py-3"
        >
          <Tooltip label={copy.nav.tipHome}>
            <Link href="/chat" className="flex min-w-0 items-center gap-2 text-content sm:gap-3">
              <SoficauMark size={32} />
              <span className="truncate text-base font-semibold tracking-tight sm:text-lg">
                {copy.product.name}
              </span>
            </Link>
          </Tooltip>
          <div className="hidden lg:block">
            <NavLinks pathname={pathname} links={links} />
          </div>
          <div className="ml-auto hidden min-w-0 items-center gap-3 lg:flex">
            <p className="min-w-0 text-sm">
              <span className="block truncate font-semibold">{displayName}</span>
              <span className="text-content-muted">{roleLabel}</span>
            </p>
            <Button variant="secondary" tooltip={copy.nav.tipSignOut} onClick={signOut}>
              {copy.nav.signOut}
            </Button>
          </div>
          <div className="ml-auto lg:hidden">
            <Button
              variant="secondary"
              size="icon"
              aria-label={menuOpen ? copy.nav.menuClose : copy.nav.menuOpen}
              tooltip={menuOpen ? copy.nav.tipMenuClose : copy.nav.tipMenuOpen}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              {menuOpen ? <IconClose /> : <IconMenu />}
            </Button>
          </div>
        </Surface>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>

      <Sheet
        open={menuOpen}
        title={copy.nav.menuTitle}
        side="right"
        onClose={() => setMenuOpen(false)}
      >
        <div className="flex flex-col gap-6 px-5 py-5">
          <NavLinks
            pathname={pathname}
            links={links}
            onNavigate={() => setMenuOpen(false)}
          />
          <Surface elevation="pressed" radius="surface" className="px-4 py-3">
            <p className="truncate font-semibold">{displayName}</p>
            <p className="text-sm text-content-muted">{roleLabel}</p>
          </Surface>
          <Button
            variant="secondary"
            tooltip={copy.nav.tipSignOut}
            onClick={() => {
              setMenuOpen(false);
              signOut();
            }}
          >
            {copy.nav.signOut}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
