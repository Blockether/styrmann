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

        ;; Settings
        :settings/title "Settings"
        :settings/llm-providers "LLM Providers"
        :settings/runner-settings "Runner Settings"
        :settings/no-providers "No providers configured."
        :settings/add-provider "Add provider"
        :settings/provider-name "Name"
        :settings/provider-base-url "Base URL"
        :settings/provider-api-key "API Key"
        :settings/provider-set-default "Set as default provider"
        :settings/provider-description "Configure LLM provider credentials for Svar. Each provider defines an API endpoint and key."
        :settings/runner-description "Configure the execution environment for agent sessions. Each workspace can use a different LLM provider."
        :settings/runner-workspace "Workspace"
        :settings/runner-provider "Provider"
        :settings/runner-model "Model"
        :settings/runner-working-directory "Working directory"
        :settings/runner-status "Status"
        :settings/runner-save "Save runner settings"
        :settings/runner-no-workspace "Create a workspace first."
        :settings/provider-default "default"
        :settings/provider-set-as-default "set as default"
        :settings/status-ready "Ready"
        :settings/status-busy "Busy"
        :settings/status-offline "Offline"
        :settings/status-error "Error"
        :settings/manage-description "Manage LLM providers and execution settings for this organization."
        :settings/current-organization "Current organization"
        :settings/is-default-org "This organization is the default landing organization."
        :settings/not-default-org "This organization is not the default landing organization yet."

        ;; Task detail
        :task/deliverables "Deliverables"
        :task/events "Events"
        :task/no-logs "No logs captured yet."

        ;; Home
        :home/headline-1 "Your organizations,"
        :home/headline-2 "organized"
        :home/subtitle "Manage organization boards, backlog grooming, sprint planning, and delivery tasks from one place."
        :home/org-subtitle "Backlog, sprints, and delivery management"
        :home/no-orgs "No organizations yet. Create your first one to get started."
        :home/create-org "Create organization"
        :home/org-name "Organization name"
        :home/create-btn "Create"

        ;; Workspace
        :workspace/no-tasks "No tasks assigned to this workspace yet."
        :workspace/all-tasks "All tasks"

        ;; Board
        :board/no-items "No items"

        ;; Task card
        :task-card/done "Done"

        ;; Misc
        :misc/none "None"
        :misc/no-milestones "No milestones"
        :misc/no-sprints "No sprints"
        :misc/go-to-settings "Go to settings"}

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
