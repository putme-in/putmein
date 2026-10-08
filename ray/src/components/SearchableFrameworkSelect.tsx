"use client";

import { useState, useRef, useEffect, useId } from "react";
import { Icon } from "@iconify/react";
import { FRAMEWORKS } from "@/lib/framework-registry";

// Icon mapping for frameworks
const FRAMEWORK_ICONS: Record<string, string> = {
  auto: "lucide:sparkles",
  nextjs: "logos:nextjs-icon",
  nuxt: "logos:nuxt-icon",
  sveltekit: "logos:svelte-icon",
  vue: "logos:vue",
  react: "logos:react",
  express: "logos:nodejs-icon",
  fastify: "logos:fastify-icon",
  django: "logos:django-icon",
  fastapi: "logos:fastapi-icon",
  flask: "logos:flask",
  laravel: "logos:laravel",
  ruby: "logos:ruby",
  go: "logos:go",
  rust: "logos:rust",
  java: "logos:java",
  php: "logos:php",
  python: "logos:python",
  node: "logos:nodejs-icon",
  static: "logos:html-5",
  docker: "logos:docker-icon",
};

export function getFrameworkIcon(slug: string): string {
  return FRAMEWORK_ICONS[slug] || "lucide:box";
}

interface SearchableFrameworkSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function SearchableFrameworkSelect({
  value,
  onChange,
  disabled = false,
}: SearchableFrameworkSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const allOptions: Array<{ slug: string; name: string; language?: string }> = [
    { slug: "auto", name: "Auto-detect (Recommended)" },
    ...FRAMEWORKS.map((f) => ({ slug: f.slug, name: f.name, language: f.language })),
  ];

  const filteredOptions = allOptions.filter((opt) => {
    const q = search.toLowerCase();
    return (
      opt.name.toLowerCase().includes(q) ||
      opt.slug.toLowerCase().includes(q) ||
      (opt.language && opt.language.toLowerCase().includes(q))
    );
  });

  const selectedOption = allOptions.find((opt) => opt.slug === value) || allOptions[0];

  return (
    <div ref={containerRef} className="relative w-full">
      <label htmlFor={`${id}-btn`} className="ray-eyebrow block mb-1.5">
        Framework Preset
      </label>

      {/* Trigger Button */}
      <button
        id={`${id}-btn`}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className="ray-input flex items-center justify-between gap-2.5 text-left text-xs cursor-pointer hover:border-white/20 transition-all select-none disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-5 h-5 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
            <Icon icon={getFrameworkIcon(selectedOption.slug)} width={14} height={14} />
          </div>
          <span className="font-medium text-white truncate">{selectedOption.name}</span>
          {selectedOption.language && (
            <span className="text-[10px] font-mono text-white/40 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.06]">
              {selectedOption.language}
            </span>
          )}
        </div>

        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`shrink-0 text-white/40 transition-transform duration-200 ${
            isOpen ? "rotate-180 text-white" : ""
          }`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-xl bg-[#0c0c0c] border border-white/[0.12] shadow-2xl p-2 animate-fade-in flex flex-col max-h-72">
          {/* Search Input Box */}
          <div className="relative mb-2 shrink-0">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search frameworks (e.g. Next.js, Python, FastAPI)..."
              className="w-full bg-black/60 border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-white/30 transition-colors"
            />
          </div>

          {/* Options List */}
          <div className="overflow-y-auto flex flex-col gap-0.5 pr-0.5">
            {filteredOptions.length === 0 ? (
              <div className="py-4 text-center text-xs text-white/40">
                No matching frameworks found
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.slug === value;
                return (
                  <button
                    key={opt.slug}
                    type="button"
                    onClick={() => {
                      onChange(opt.slug);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-white/[0.08] text-white font-medium"
                        : "text-white/70 hover:bg-white/[0.04] hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-5 h-5 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                        <Icon icon={getFrameworkIcon(opt.slug)} width={13} height={13} />
                      </div>
                      <span className="truncate">{opt.name}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {opt.language && (
                        <span className="text-[10px] font-mono text-white/30">
                          {opt.language}
                        </span>
                      )}
                      {isSelected && (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          className="text-emerald-400"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
