"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2, Moon, Plus, Save, Sun, Trash2, Upload, X } from "lucide-react";
import type { LandingPageSettings } from "@/app/api/admin/landing-page/route";

type LogoVariant = "light" | "dark";

interface LogoUploadBlockProps {
  variant: LogoVariant;
  preview: string;
  onPreviewChange: (url: string) => void;
  onFormUrlChange: (url: string) => void;
}

function LogoUploadBlock({ variant, preview, onPreviewChange, onFormUrlChange }: LogoUploadBlockProps) {
  const [uploading, setUploading] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const label = variant === "light" ? "Light mode logo" : "Dark mode logo";
  const bg = variant === "light"
    ? "bg-white border-neutral-200"
    : "bg-neutral-900 border-neutral-700";
  const placeholderColor = variant === "light" ? "text-neutral-400" : "text-neutral-500";

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Logo must be smaller than 2 MB"); return; }
    onPreviewChange(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/assets/logo?variant=${variant}`, { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d?.error ?? "Upload failed");
        onPreviewChange("");
        return;
      }
      const { url } = await res.json() as { url: string };
      onPreviewChange(`${url}&t=${Date.now()}`);
      onFormUrlChange(url);
      toast.success(`${label} uploaded`);
    } catch {
      toast.error("Upload failed");
      onPreviewChange("");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      const res = await fetch(`/api/admin/assets/logo?variant=${variant}`, { method: "DELETE" });
      if (!res.ok) { toast.error("Failed to remove logo"); return; }
      onPreviewChange("");
      onFormUrlChange("");
      toast.success(`${label} removed`);
    } catch {
      toast.error("Failed to remove logo");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {variant === "light" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className={`relative flex h-16 w-44 items-center justify-center overflow-hidden rounded-lg border ${bg}`}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={label} className="h-full w-full object-contain p-1" />
        ) : (
          <span className={`text-[11px] ${placeholderColor}`}>No logo</span>
        )}
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-neutral-900/70">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={uploading || removing}
          onClick={() => inputRef.current?.click()}>
          <Upload className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">{preview ? "Replace" : "Upload"}</span>
        </Button>
        {preview && (
          <Button type="button" variant="ghost" size="sm" disabled={uploading || removing}
            className="text-red-500 hover:text-red-600"
            onClick={handleRemove}>
            {removing ? <Loader2 className="h-4 w-4 animate-spin sm:hidden lg:inline" /> : <X className="h-4 w-4 sm:hidden lg:inline" />}
            <span className="hidden sm:inline">Remove</span>
          </Button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden" onChange={handleChange} />
    </div>
  );
}

export default function LandingPageSettingsPage() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<LandingPageSettings | null>(null);

  const [logoLightPreview, setLogoLightPreview] = React.useState<string>("");
  const [logoDarkPreview, setLogoDarkPreview] = React.useState<string>("");

  React.useEffect(() => {
    fetch("/api/admin/landing-page")
      .then((r) => r.json())
      .then((data: LandingPageSettings) => {
        setForm(data);
        setLogoLightPreview(data.logoUrl ? `${data.logoUrl}&t=${Date.now()}` : "");
        setLogoDarkPreview(data.logoUrlDark ? `${data.logoUrlDark}&t=${Date.now()}` : "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof LandingPageSettings>(key: K, value: LandingPageSettings[K]) {
    setForm((f) => f ? { ...f, [key]: value } : f);
  }

  function setCard(i: number, field: "title" | "description", value: string) {
    setForm((f) => {
      if (!f) return f;
      const cards = f.featureCards.map((c, idx) =>
        idx === i ? { ...c, [field]: value } : c
      );
      return { ...f, featureCards: cards };
    });
  }

  function addCard() {
    setForm((f) => f ? { ...f, featureCards: [...f.featureCards, { title: "", description: "" }] } : f);
  }

  function removeCard(i: number) {
    setForm((f) => f ? { ...f, featureCards: f.featureCards.filter((_, idx) => idx !== i) } : f);
  }

  function setHighlight(i: number, value: string) {
    setForm((f) => {
      if (!f) return f;
      const h = f.highlights.map((h, idx) => (idx === i ? value : h));
      return { ...f, highlights: h };
    });
  }

  function addHighlight() {
    setForm((f) => f ? { ...f, highlights: [...f.highlights, ""] } : f);
  }

  function removeHighlight(i: number) {
    setForm((f) => f ? { ...f, highlights: f.highlights.filter((_, idx) => idx !== i) } : f);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/landing-page", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error ?? "Failed to save");
        return;
      }
      toast.success("Landing page saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!form) return null;

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Landing Page</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Edit the public-facing landing page that visitors see before signing in.
          </p>
        </div>
        <Button onClick={save} disabled={saving} className="shrink-0">
          {saving ? <Loader2 className="h-4 w-4 animate-spin sm:hidden lg:inline" /> : <Save className="h-4 w-4 sm:hidden lg:inline" />}
          <span className="hidden sm:inline">{saving ? "Saving…" : "Save"}</span>
        </Button>
      </div>

      <Separator />

      {/* Branding */}
      <Card>
        <CardHeader><CardTitle>Branding</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* Logo upload — light + dark */}
          <div className="grid gap-2">
            <Label>Logo</Label>
            <div className="flex flex-wrap gap-6">
              <LogoUploadBlock
                variant="light"
                preview={logoLightPreview}
                onPreviewChange={setLogoLightPreview}
                onFormUrlChange={(url) => setForm((f) => f ? { ...f, logoUrl: url } : f)}
              />
              <LogoUploadBlock
                variant="dark"
                preview={logoDarkPreview}
                onPreviewChange={setLogoDarkPreview}
                onFormUrlChange={(url) => setForm((f) => f ? { ...f, logoUrlDark: url } : f)}
              />
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              PNG, JPG, WEBP, or SVG — max 2 MB each. The correct logo is shown automatically based on the visitor&apos;s theme. When no logo is set, the brand name is shown instead.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label>Brand name (shown in navbar &amp; footer when no logo)</Label>
            <Input value={form.brandName} onChange={(e) => set("brandName", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Footer company name</Label>
            <Input value={form.footerName} onChange={(e) => set("footerName", e.target.value)} placeholder="e.g. Bravo General Insurance Interface" />
          </div>
        </CardContent>
      </Card>

      {/* Hero */}
      <Card>
        <CardHeader><CardTitle>Hero Section</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Heading (line 1)</Label>
            <Input value={form.heroHeading} onChange={(e) => set("heroHeading", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Heading accent (line 2, greyed out)</Label>
            <Input value={form.heroHeadingAccent} onChange={(e) => set("heroHeadingAccent", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <textarea
              rows={3}
              value={form.heroDescription}
              onChange={(e) => set("heroDescription", e.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-neutral-500 focus-visible:border-neutral-400 focus-visible:outline-none dark:border-neutral-800 dark:placeholder:text-neutral-400"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>CTA button label</Label>
            <Input value={form.heroCta} onChange={(e) => set("heroCta", e.target.value)} placeholder="Get started" />
          </div>
        </CardContent>
      </Card>

      {/* Features */}
      <Card>
        <CardHeader><CardTitle>Features Section</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Section heading</Label>
            <Input value={form.featuresHeading} onChange={(e) => set("featuresHeading", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Section subheading</Label>
            <textarea
              rows={2}
              value={form.featuresSubheading}
              onChange={(e) => set("featuresSubheading", e.target.value)}
              className="flex min-h-[60px] w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-neutral-500 focus-visible:border-neutral-400 focus-visible:outline-none dark:border-neutral-800 dark:placeholder:text-neutral-400"
            />
          </div>

          <div className="space-y-3">
            <Label>Feature cards (max 6)</Label>
            {form.featureCards.map((card, i) => (
              <div key={i} className="flex gap-2 items-start rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="flex-1 grid gap-2">
                  <Input
                    placeholder="Card title"
                    value={card.title}
                    onChange={(e) => setCard(i, "title", e.target.value)}
                  />
                  <Input
                    placeholder="Card description"
                    value={card.description}
                    onChange={(e) => setCard(i, "description", e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-1 shrink-0 text-neutral-400 hover:text-red-500"
                  onClick={() => removeCard(i)}
                  disabled={form.featureCards.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {form.featureCards.length < 6 && (
              <Button type="button" variant="outline" size="sm" onClick={addCard}>
                <Plus className="h-4 w-4 sm:hidden lg:inline" />
                <span className="hidden sm:inline">Add card</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Highlights */}
      <Card>
        <CardHeader><CardTitle>Highlights Section</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Section heading</Label>
            <Input value={form.highlightsHeading} onChange={(e) => set("highlightsHeading", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Bullet points</Label>
            {form.highlights.map((h, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={h}
                  onChange={(e) => setHighlight(i, e.target.value)}
                  placeholder="Bullet point text"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-neutral-400 hover:text-red-500"
                  onClick={() => removeHighlight(i)}
                  disabled={form.highlights.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addHighlight}>
              <Plus className="h-4 w-4 sm:hidden lg:inline" />
              <span className="hidden sm:inline">Add bullet</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* CTA */}
      <Card>
        <CardHeader><CardTitle>Bottom CTA Section</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Heading</Label>
            <Input value={form.ctaHeading} onChange={(e) => set("ctaHeading", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Subheading</Label>
            <Input value={form.ctaSubheading} onChange={(e) => set("ctaSubheading", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pb-8">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin sm:hidden lg:inline" /> : <Save className="h-4 w-4 sm:hidden lg:inline" />}
          <span className="hidden sm:inline">{saving ? "Saving…" : "Save changes"}</span>
        </Button>
      </div>
    </main>
  );
}
