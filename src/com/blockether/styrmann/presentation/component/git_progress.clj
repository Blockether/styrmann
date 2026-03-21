(ns com.blockether.styrmann.presentation.component.git-progress
  "Reusable git progress display for tickets and tasks."
  (:require
   [clojure.string :as str]))

(defn- short-sha [sha]
  (when sha (subs sha 0 (min 7 (count sha)))))

(defn- commit-row [{:keys [sha message author date]}]
  [:div {:class "flex items-start gap-3 py-2.5 border-b border-[var(--line)] last:border-b-0"}
   [:div {:class "flex-shrink-0 mt-0.5"}
    [:code {:class "text-[12px] px-1.5 py-0.5 rounded bg-[var(--cream-dark)] text-[var(--accent)] font-mono"}
     (short-sha sha)]]
   [:div {:class "flex-1 min-w-0"}
    [:div {:class "text-[13px] leading-snug truncate"} (first (str/split-lines (or message "")))]
    [:div {:class "text-[12px] text-[var(--muted)] mt-0.5"}
     (when author [:span author])
     (when (and author date) [:span " · "])
     (when date [:span (str date)])]]])

(defn commits-section
  "Render a git commits section.

   Params:
   `commits` - Vector of commit maps with :sha, :message, :author, :date.
   `opts`    - Optional map with :title (default 'Git Activity')."
  [commits {:keys [title] :or {title "Git Activity"}}]
  (when (seq commits)
    [:div {:class "card p-5"}
     [:div {:class "flex items-center gap-3 mb-3"}
      [:i {:data-lucide "git-commit-horizontal" :class "w-4 h-4 text-[var(--accent)]"}]
      [:div {:class "field-label !mb-0"} title]
      [:span {:class "text-[12px] text-[var(--muted)]"} (str (count commits) " commits")]]
     (into [:div] (map commit-row (take 10 commits)))
     (when (> (count commits) 10)
       [:div {:class "text-[12px] text-[var(--muted)] text-center pt-2"}
        (str "+" (- (count commits) 10) " more commits")])]))
