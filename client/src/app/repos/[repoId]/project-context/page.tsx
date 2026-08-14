/* /repos/:repoId/project-context — Project Context discovery page.
   RSC shell: renders the AppShell + hands off to the interactive
   ProjectContextView client component. */

import React from "react";
import { AppShell } from "@/components/app-shell";
import { ProjectContextView } from "./_components/ProjectContextView";

interface PageProps {
  params: Promise<{ repoId: string }>;
}

export default async function ProjectContextPage({ params }: PageProps) {
  const { repoId } = await params;
  return (
    <AppShell>
      <ProjectContextView repoId={repoId} />
    </AppShell>
  );
}
