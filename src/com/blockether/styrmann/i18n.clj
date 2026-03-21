(ns com.blockether.styrmann.i18n
  "Internationalization — Tongue-based translations and pluralization."
  (:require
   [tongue.core :as tongue]))

(def ^:private dicts
  {:en {:tongue/missing-key "?{1}"

        ;; Pluralization
        :n/ticket (fn [n] (if (= 1 n) "{1} ticket" "{1} tickets"))
        :n/task   (fn [n] (if (= 1 n) "{1} task" "{1} tasks"))
        :n/dep    (fn [n] (if (= 1 n) "{1} dep" "{1} deps"))
        :n/item   (fn [n] (if (= 1 n) "{1} item" "{1} items"))
        :n/done   "{1}/{2} done"
        :n/complete "{1}/{2} complete"

        ;; Board
        :board/no-tickets "No tickets assigned"
        :board/show-closed "Show closed"
        :board/show-done "Show done"

        ;; Ticket
        :ticket/acceptance-criteria "Acceptance Criteria"
        :ticket/workflow "Workflow"
        :ticket/no-tasks "No tasks yet."
        :ticket/add-manually "Add task manually"
        :ticket/decompose "Decompose into tasks"

        ;; Task
        :task/run-history "Run history"
        :task/no-runs "No process runs recorded."
        :task/transition "Transition"

        ;; Activity
        :activity/title "Activity"
        :activity/empty "No activity yet."

        ;; Actions
        :action/start-progress "Start progress"
        :action/send-verification "Send to verification"
        :action/close "Close ticket"
        :action/reopen "Reopen ticket"
        :action/create-org "Create organization"

        ;; Details
        :details/title "Details"
        :details/assignee "Assignee"
        :details/story-points "Story Points"
        :details/effort "Effort"
        :details/impact "Impact"
        :details/organization "Organization"
        :details/sprint "Sprint"
        :details/milestone "Milestone"
        :details/workspace "Workspace"
        :details/status "Status"
        :details/runs "Runs"
        :details/ticket "Ticket"

        ;; Misc
        :misc/none "None"
        :misc/no-milestones "No milestones"
        :misc/no-sprints "No sprints"}

   :tongue/fallback :en})

(def tr
  "Translate a key with optional args. Usage: (tr :en :n/ticket 3) => \"3 tickets\""
  (tongue/build-translate dicts))

(defn t
  "Translate with default locale :en. Usage: (t :n/ticket 5) => \"5 tickets\""
  ([k] (tr :en k))
  ([k a1] (tr :en k a1))
  ([k a1 a2] (tr :en k a1 a2))
  ([k a1 a2 a3] (tr :en k a1 a2 a3)))
