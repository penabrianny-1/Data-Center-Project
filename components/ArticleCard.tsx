import { formatDate } from "@/lib/format";
import type { Article } from "@/lib/types";

export default function ArticleCard({ article }: { article: Article }) {
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col bg-white border border-slate-200 rounded-xl p-5 transition-all hover:border-slate-300 hover:shadow-sm"
    >
      <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{article.type}</span>
        <time dateTime={article.date}>{formatDate(article.date, { month: "short" })}</time>
      </div>
      <h3 className="mt-3 font-semibold leading-snug text-slate-900 group-hover:text-blue-600">{article.title}</h3>
      {article.excerpt && <p className="mt-2 text-sm text-slate-600 line-clamp-3">{article.excerpt}</p>}
      <div className="mt-auto pt-3 text-xs text-slate-400">
        {article.author ?? "American Action Forum"}
      </div>
    </a>
  );
}
