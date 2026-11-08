import type { OptionColor, PropertyType, ViewType } from "./types";

/** Built-in templates people can add in one click. Everything they create is ordinary, editable data. */
export interface GalleryProperty {
  name: string;
  type: PropertyType;
  options?: { name: string; color: OptionColor }[];
  formula?: string;
}
export interface GalleryView {
  name: string;
  type: ViewType;
  groupBy?: string;
  date?: string;
  sort?: { property: string; direction: "asc" | "desc" };
  hidden?: string[];
}
export interface GalleryNode {
  title: string;
  icon?: string;
  markdown?: string;
  children?: GalleryNode[];
  database?: {
    properties: GalleryProperty[];
    views: GalleryView[];
    rows?: { title: string; values?: Record<string, unknown>; markdown?: string }[];
    templates?: { title: string; values?: Record<string, unknown>; markdown?: string }[];
  };
}
export interface GalleryTemplate {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: "Projects" | "Personal" | "Work" | "Content";
  root: GalleryNode;
}

const STATUS = (names: [string, OptionColor][]) => names.map(([name, color]) => ({ name, color }));

export const GALLERY: GalleryTemplate[] = [
  {
    key: "video-projects",
    name: "Video projects",
    description: "Plan, script, film and publish videos. Board by stage, calendar by publish date, and a script template for every new video.",
    icon: "🎬",
    category: "Content",
    root: {
      title: "Video Projects",
      icon: "🎬",
      database: {
        properties: [
          { name: "Stage", type: "status", options: STATUS([["Idea", "gray"], ["Scripting", "yellow"], ["Filming", "orange"], ["Editing", "purple"], ["Published", "green"]]) },
          { name: "Platform", type: "multi_select", options: STATUS([["YouTube", "red"], ["TikTok", "pink"], ["Instagram", "purple"], ["Shorts", "orange"]]) },
          { name: "Publish date", type: "date" },
          { name: "Length (min)", type: "number" },
          { name: "Views", type: "number" },
          { name: "Link", type: "url" },
          { name: "Days to publish", type: "formula", formula: 'if(empty(prop("Publish date")), "", dateBetween(prop("Publish date"), today(), "days"))' },
        ],
        views: [
          { name: "Pipeline", type: "board", groupBy: "Stage" },
          { name: "Calendar", type: "calendar", date: "Publish date" },
          { name: "All videos", type: "table", sort: { property: "Publish date", direction: "desc" } },
          { name: "Gallery", type: "gallery" },
        ],
        rows: [
          { title: "Channel trailer", values: { Stage: "Editing", Platform: ["YouTube"], "Length (min)": 2 } },
          { title: "Behind the scenes", values: { Stage: "Idea", Platform: ["Instagram", "TikTok"] } },
        ],
        templates: [
          {
            title: "New video",
            values: { Stage: "Idea" },
            markdown:
              "## Hook\n\nWhat makes someone stay for the first 10 seconds?\n\n## Outline\n\n1. Intro\n2. Main point\n3. Call to action\n\n## Script\n\n\n## Shot list\n\n- [ ] A-roll\n- [ ] B-roll\n- [ ] Thumbnail photo\n\n## Publishing checklist\n\n- [ ] Title and description\n- [ ] Thumbnail\n- [ ] Captions\n- [ ] End screen",
          },
        ],
      },
    },
  },
  {
    key: "projects-tasks",
    name: "Projects & tasks",
    description: "Track tasks by status and priority with due dates, a board and a 'days left' formula.",
    icon: "✅",
    category: "Projects",
    root: {
      title: "Tasks",
      icon: "✅",
      database: {
        properties: [
          { name: "Status", type: "status", options: STATUS([["Not started", "gray"], ["In progress", "blue"], ["Done", "green"]]) },
          { name: "Priority", type: "select", options: STATUS([["High", "red"], ["Medium", "yellow"], ["Low", "gray"]]) },
          { name: "Due", type: "date" },
          { name: "Project", type: "select", options: [] },
          { name: "Days left", type: "formula", formula: 'if(empty(prop("Due")), "", dateBetween(prop("Due"), today(), "days"))' },
        ],
        views: [
          { name: "Board", type: "board", groupBy: "Status" },
          { name: "All tasks", type: "table", sort: { property: "Due", direction: "asc" } },
          { name: "Calendar", type: "calendar", date: "Due" },
        ],
        rows: [{ title: "Try Max's slash menu", values: { Status: "Not started", Priority: "Medium" } }],
        templates: [{ title: "Task", values: { Status: "Not started" }, markdown: "## Goal\n\n\n## Notes\n\n\n## Checklist\n\n- [ ] " }],
      },
    },
  },
  {
    key: "meeting-notes",
    name: "Meeting notes",
    description: "A meetings database with a ready agenda, notes and action items template.",
    icon: "🗓️",
    category: "Work",
    root: {
      title: "Meetings",
      icon: "🗓️",
      database: {
        properties: [
          { name: "Date", type: "date" },
          { name: "Type", type: "select", options: STATUS([["1:1", "blue"], ["Team", "green"], ["Planning", "purple"], ["Review", "orange"]]) },
          { name: "Created", type: "created_time" },
        ],
        views: [{ name: "Recent", type: "table", sort: { property: "Date", direction: "desc" } }, { name: "Calendar", type: "calendar", date: "Date" }],
        templates: [{ title: "Meeting {{today}}", values: { Date: "{{today}}" }, markdown: "## Agenda\n\n- \n\n## Notes\n\n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] " }],
      },
    },
  },
  {
    key: "reading-list",
    name: "Reading list",
    description: "Books, articles and courses with ratings, shown as a gallery.",
    icon: "📚",
    category: "Personal",
    root: {
      title: "Reading List",
      icon: "📚",
      database: {
        properties: [
          { name: "Type", type: "select", options: STATUS([["Book", "brown"], ["Article", "blue"], ["Course", "purple"], ["Podcast", "orange"]]) },
          { name: "Status", type: "status", options: STATUS([["Want to read", "gray"], ["Reading", "blue"], ["Finished", "green"]]) },
          { name: "Author", type: "text" },
          { name: "Rating", type: "select", options: STATUS([["★★★★★", "yellow"], ["★★★★", "yellow"], ["★★★", "yellow"], ["★★", "gray"], ["★", "gray"]]) },
          { name: "Link", type: "url" },
        ],
        views: [{ name: "Gallery", type: "gallery" }, { name: "By status", type: "board", groupBy: "Status" }, { name: "Table", type: "table" }],
        templates: [{ title: "New book", values: { Type: "Book", Status: "Want to read" }, markdown: "## Why I'm reading this\n\n\n## Key ideas\n\n- \n\n## Quotes\n\n> " }],
      },
    },
  },
  {
    key: "content-calendar",
    name: "Content calendar",
    description: "Posts across channels on a calendar, with drafts and a publishing board.",
    icon: "📅",
    category: "Content",
    root: {
      title: "Content Calendar",
      icon: "📅",
      database: {
        properties: [
          { name: "Status", type: "status", options: STATUS([["Draft", "gray"], ["Ready", "yellow"], ["Scheduled", "blue"], ["Posted", "green"]]) },
          { name: "Channel", type: "multi_select", options: STATUS([["Blog", "brown"], ["Newsletter", "blue"], ["LinkedIn", "blue"], ["X", "gray"], ["Instagram", "purple"]]) },
          { name: "Publish on", type: "date" },
        ],
        views: [{ name: "Calendar", type: "calendar", date: "Publish on" }, { name: "Board", type: "board", groupBy: "Status" }, { name: "Table", type: "table" }],
        templates: [{ title: "New post", values: { Status: "Draft" }, markdown: "## Angle\n\n\n## Draft\n\n" }],
      },
    },
  },
  {
    key: "journal",
    name: "Journal",
    description: "A private daily journal. Each new entry is dated and starts with gentle prompts.",
    icon: "📓",
    category: "Personal",
    root: {
      title: "Journal",
      icon: "📓",
      database: {
        properties: [
          { name: "Date", type: "date" },
          { name: "Mood", type: "select", options: STATUS([["Great", "green"], ["Good", "blue"], ["Okay", "yellow"], ["Low", "gray"]]) },
        ],
        views: [{ name: "Entries", type: "list", sort: { property: "Date", direction: "desc" } }, { name: "Calendar", type: "calendar", date: "Date" }],
        templates: [{ title: "{{today}}", values: { Date: "{{today}}" }, markdown: "## Grateful for\n\n- \n\n## Today\n\n\n## Tomorrow I want to\n\n- [ ] " }],
      },
    },
  },
  {
    key: "weekly-planner",
    name: "Weekly planner",
    description: "One page for the week: priorities, a to-do list per day and a short review.",
    icon: "🗒️",
    category: "Personal",
    root: {
      title: "Weekly Planner",
      icon: "🗒️",
      markdown:
        "> [!TIP]\n> Duplicate this page every Monday.\n\n## Top 3 priorities\n\n1. \n2. \n3. \n\n## Monday\n\n- [ ] \n\n## Tuesday\n\n- [ ] \n\n## Wednesday\n\n- [ ] \n\n## Thursday\n\n- [ ] \n\n## Friday\n\n- [ ] \n\n## Weekend\n\n- [ ] \n\n---\n\n## Review\n\nWhat went well? What will I change next week?",
    },
  },
  {
    key: "wiki",
    name: "Personal wiki",
    description: "A home for how-tos and references, with nested pages ready to fill.",
    icon: "📖",
    category: "Work",
    root: {
      title: "Wiki",
      icon: "📖",
      markdown: "Everything I want to remember, in one place.\n\n> [!INFO]\n> Add a subpage for each topic. Use / to insert blocks and @ to link pages.",
      children: [
        { title: "Getting started", icon: "🚀", markdown: "## Setup\n\n\n## Accounts\n\n" },
        { title: "How-tos", icon: "🛠️", markdown: "- " },
        { title: "References", icon: "🔖", markdown: "| Name | Link | Notes |\n| --- | --- | --- |\n|  |  |  |" },
      ],
    },
  },
];
