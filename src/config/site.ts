export const site = {
  name: "Sheng Wan",
  shortName: "SW",
  title: "Sheng Wan — Political Science",
  description:
    "Sheng Wan is a PhD student in Political Science at the University of Washington studying feminist political theory, gender equality in China, and political sentiments in digital spaces.",
  email: "swan0624@uw.edu",
  phone: "+1 909 991 0548",
  phoneHref: "+19099910548",
  office: "034 Gowen Hall, Seattle, WA 98195",
  links: {
    github: "https://github.com/Tocqueville0624",
    linkedin: "https://www.linkedin.com/in/sheng-wan-043ab82aa/"
  },
  repository: "https://github.com/Tocqueville0624/sheng-wan"
} as const;

export const navigation = [
  { href: "/", label: "Home" },
  { href: "/cv", label: "CV" },
  { href: "/research", label: "Research" },
  { href: "/teaching", label: "Teaching" }
] as const;

export const playgroundNavigation = [
  { href: "/playground/thales-olive", label: "Thales’ Olive" },
  { href: "/playground/hugo-le-chatssius", label: "Hugo, Le Chatssius" },
  { href: "/playground/photo-gallery", label: "Photo Gallery" }
] as const;
