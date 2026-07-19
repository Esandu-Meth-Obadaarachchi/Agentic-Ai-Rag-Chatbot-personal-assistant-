"use client";

import { PageView } from "@/components/pages/PageView";

export default function PageDetail({ params }: { params: { id: string } }) {
  return <PageView id={params.id} />;
}
