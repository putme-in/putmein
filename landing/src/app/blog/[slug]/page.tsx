import React from 'react';
import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import CursorGlow from '@/components/CursorGlow';
import { Article, WithContext, BreadcrumbList } from 'schema-dts';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await prisma.post.findUnique({
    where: { slug },
  });

  if (!post) return {};

  const title = post.metaTitle || `${post.title} | Putme.in Blog`;
  const description = post.metaDescription || post.excerpt || `Read "${post.title}" on the Putme.in Blog.`;

  return {
    title,
    description,
    keywords: post.metaKeywords || undefined,
    authors: [{ name: 'Putme.in Team', url: 'https://putme.in' }],
    openGraph: {
      title: post.title,
      description,
      type: 'article',
      publishedTime: post.createdAt.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      url: `https://putme.in/blog/${post.slug}`,
      siteName: 'Putme.in',
      images: post.coverImage
        ? [
            {
              url: post.coverImage,
              width: 1200,
              height: 630,
              alt: post.title,
            },
          ]
        : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description,
      images: post.coverImage ? [post.coverImage] : [],
    },
    alternates: {
      canonical: `https://putme.in/blog/${post.slug}`,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await prisma.post.findUnique({
    where: { slug },
  });

  if (!post || !post.isPublished) {
    notFound();
  }

  // Fetch related posts (latest 3 excluding current)
  let relatedPosts: { id: string; slug: string; title: string; excerpt: string | null; coverImage: string | null; createdAt: Date }[] = [];
  try {
    relatedPosts = await prisma.post.findMany({
      where: { isPublished: true, id: { not: post.id } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, slug: true, title: true, excerpt: true, coverImage: true, createdAt: true },
    });
  } catch {
    // Graceful degradation
  }

  // Article structured data for SEO/AEO/GEO
  const articleJsonLd: WithContext<Article> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.metaDescription || post.excerpt || undefined,
    image: post.coverImage || undefined,
    datePublished: post.createdAt.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    url: `https://putme.in/blog/${post.slug}`,
    author: {
      '@type': 'Organization',
      name: 'Putme.in',
      url: 'https://putme.in',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Putme.in',
      url: 'https://putme.in',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://putme.in/blog/${post.slug}`,
    },
  };

  // Breadcrumb structured data for GEO
  const breadcrumbJsonLd: WithContext<BreadcrumbList> = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://putme.in',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Blog',
        item: 'https://putme.in/blog',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: post.title,
        item: `https://putme.in/blog/${post.slug}`,
      },
    ],
  };

  // Extract reading time estimate
  const wordCount = post.content.replace(/<[^>]*>/g, '').split(/\s+/).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  // Extract tags from metaKeywords
  const tags = post.metaKeywords
    ? post.metaKeywords.split(',').map((t: string) => t.trim()).filter(Boolean)
    : [];

  return (
    <div className="min-h-screen bg-black text-white font-sans overflow-x-hidden selection:bg-blue-500/30">
      <CursorGlow />
      <Navbar />

      {/* Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <article className="relative">
        {/* Hero Section */}
        <header className="relative pt-32 pb-12 px-6 md:px-16 max-w-4xl mx-auto">
          {/* Breadcrumbs */}
          <nav aria-label="Breadcrumb" className="mb-8">
            <ol className="flex items-center gap-2 text-sm text-zinc-500">
              <li>
                <Link href="/" className="hover:text-white transition-colors">Home</Link>
              </li>
              <li className="text-zinc-700">/</li>
              <li>
                <Link href="/blog" className="hover:text-white transition-colors">Blog</Link>
              </li>
              <li className="text-zinc-700">/</li>
              <li className="text-zinc-400 truncate max-w-[200px]">{post.title}</li>
            </ol>
          </nav>

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <time
              dateTime={post.createdAt.toISOString()}
              className="text-sm font-mono text-zinc-500"
            >
              {new Date(post.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>
            <span className="w-1 h-1 rounded-full bg-zinc-700" />
            <span className="text-sm text-zinc-500">{readingTime} min read</span>
            {tags.length > 0 && (
              <>
                <span className="w-1 h-1 rounded-full bg-zinc-700" />
                <div className="flex flex-wrap gap-2">
                  {tags.slice(0, 3).map((tag: string) => (
                    <span
                      key={tag}
                      className="px-2.5 py-0.5 text-xs font-medium rounded-full border border-pink-500/20 bg-pink-500/5 text-pink-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Title */}
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
            {post.title}
          </h1>

          {/* Excerpt */}
          {post.excerpt && (
            <p className="text-xl text-zinc-400 font-light leading-relaxed max-w-3xl">
              {post.excerpt}
            </p>
          )}
        </header>

        {/* Cover Image */}
        {post.coverImage && (
          <div className="px-6 md:px-16 max-w-5xl mx-auto mb-16">
            <div className="aspect-video w-full overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-pink-500/5">
              <img
                src={post.coverImage}
                alt={post.title}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )}

        {/* Article Content */}
        <div className="px-6 md:px-16 max-w-3xl mx-auto">
          <section
            className="
              prose prose-invert prose-lg max-w-none
              prose-headings:font-bold prose-headings:text-white
              prose-h2:text-3xl prose-h2:mt-12 prose-h2:mb-6
              prose-h3:text-2xl prose-h3:mt-10 prose-h3:mb-4
              prose-p:text-zinc-300 prose-p:leading-relaxed prose-p:mb-6
              prose-a:text-pink-400 prose-a:no-underline hover:prose-a:underline
              prose-strong:text-white
              prose-code:text-pink-400 prose-code:bg-zinc-800/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
              prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-2xl
              prose-blockquote:border-l-pink-500 prose-blockquote:bg-zinc-900/30 prose-blockquote:rounded-r-xl prose-blockquote:px-6 prose-blockquote:py-4
              prose-img:rounded-2xl prose-img:border prose-img:border-white/10
              prose-li:text-zinc-300 prose-li:marker:text-pink-500
              prose-hr:border-white/10
            "
            dangerouslySetInnerHTML={{ __html: post.content }}
          />
        </div>

        {/* Tags Footer */}
        {tags.length > 0 && (
          <div className="px-6 md:px-16 max-w-3xl mx-auto mt-12 pt-8 border-t border-white/10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-zinc-500 font-medium">Tags:</span>
              {tags.map((tag: string) => (
                <span
                  key={tag}
                  className="px-3 py-1 text-xs font-medium rounded-full border border-white/10 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Share & Back */}
        <div className="px-6 md:px-16 max-w-3xl mx-auto mt-8 pb-12">
          <div className="flex items-center justify-between">
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-white transition-colors group"
            >
              <span className="transition-transform group-hover:-translate-x-1">←</span>
              Back to Blog
            </Link>
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-600">Share:</span>
              <a
                href={`https://twitter.com/intent/tweet?url=https://putme.in/blog/${post.slug}&text=${encodeURIComponent(post.title)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg border border-white/10 bg-zinc-900/50 flex items-center justify-center text-zinc-500 hover:text-white hover:border-white/20 transition-all"
                aria-label="Share on Twitter"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              </a>
              <a
                href={`https://www.linkedin.com/sharing/share-offsite/?url=https://putme.in/blog/${post.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg border border-white/10 bg-zinc-900/50 flex items-center justify-center text-zinc-500 hover:text-white hover:border-white/20 transition-all"
                aria-label="Share on LinkedIn"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
              </a>
            </div>
          </div>
        </div>
      </article>

      {/* Related Posts */}
      {relatedPosts.length > 0 && (
        <section className="px-6 md:px-16 max-w-7xl mx-auto py-16 border-t border-white/10">
          <h2 className="text-2xl font-bold text-white mb-10">More Articles</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {relatedPosts.map((rp) => (
              <Link
                key={rp.id}
                href={`/blog/${rp.slug}`}
                className="group rounded-2xl border border-white/10 bg-zinc-900/50 backdrop-blur-sm overflow-hidden transition-all duration-300 hover:border-white/20 hover:bg-zinc-800/50 hover:-translate-y-1 flex flex-col"
              >
                {rp.coverImage ? (
                  <div className="aspect-video overflow-hidden">
                    <img
                      src={rp.coverImage}
                      alt={rp.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                ) : (
                  <div className="aspect-video bg-gradient-to-br from-pink-500/5 via-zinc-900 to-purple-500/5 flex items-center justify-center">
                    <svg className="w-12 h-12 text-zinc-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                    </svg>
                  </div>
                )}
                <div className="p-6 flex flex-col flex-1">
                  <time
                    dateTime={rp.createdAt.toISOString()}
                    className="text-xs font-mono text-zinc-600 mb-3"
                  >
                    {new Date(rp.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                  <h3 className="text-lg font-semibold text-white mb-2 leading-snug group-hover:text-pink-400 transition-colors line-clamp-2">
                    {rp.title}
                  </h3>
                  {rp.excerpt && (
                    <p className="text-zinc-500 text-sm leading-relaxed line-clamp-2 flex-1">
                      {rp.excerpt}
                    </p>
                  )}
                  <span className="inline-flex items-center gap-2 text-sm font-bold tracking-widest uppercase text-zinc-400 group-hover:text-white transition-all mt-auto pt-4 border-t border-white/5">
                    Read <span className="text-pink-500">→</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-16 px-6 md:px-16 max-w-7xl mx-auto border-t border-white/10 text-center">
        <div className="rounded-3xl border border-white/10 bg-zinc-900/50 p-12 md:p-16 max-w-3xl mx-auto relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-48 h-48 bg-pink-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10">
            <h2 className="pixel-font text-3xl md:text-4xl font-bold text-white mb-4">
              Ready to Scale?
            </h2>
            <p className="text-zinc-400 text-lg mb-8 max-w-lg mx-auto">
              Stop managing infrastructure and start building the future with your Digital SRE Agent.
            </p>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 text-lg font-semibold text-black bg-white rounded-xl shadow-[0_0_20px_rgba(255,255,255,0.3)] transition-all hover:bg-zinc-200 hover:scale-105 hover:shadow-[0_0_30px_rgba(255,255,255,0.5)]"
            >
              Get Early Access
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
