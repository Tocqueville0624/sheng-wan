import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const datedEntry = z.object({
  date: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  details: z.array(z.string()).default([])
});

const cv = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/cv" }),
  schema: z.object({
    education: z.array(datedEntry),
    awards: z.array(datedEntry),
    conferences: z.array(datedEntry),
    teaching: z.array(
      z.object({
        code: z.string(),
        title: z.string(),
        role: z.string(),
        institution: z.string(),
        terms: z.array(z.string()),
        url: z.url()
      })
    ),
    papers: z.array(
      z.object({
        title: z.string(),
        description: z.string()
      })
    ),
    skills: z.array(
      z.object({
        label: z.string(),
        value: z.string()
      })
    ),
    memberships: z.array(z.string())
  })
});

const research = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/research" }),
  schema: z.object({
    title: z.string(),
    status: z.string(),
    venue: z.string(),
    year: z.number(),
    abstract: z.string().optional(),
    keywords: z.array(z.string()).default([]),
    paperUrl: z.url().optional()
  })
});

const hugo = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/hugo" }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string(),
    sourceUrl: z.url(),
    sourceLabel: z.string()
  })
});

export const collections = { cv, research, hugo };
