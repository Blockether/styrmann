(ns com.blockether.styrmann.db.schema
  "Datalevin schema for the Styrmann orchestration system.")

(def schema
  {;; -- Organization ----------------------------------------------------------
   :organization/id         {:db/valueType :db.type/uuid
                             :db/unique    :db.unique/identity
                             :db/doc       "Unique organization identifier"}
   :organization/name       {:db/valueType :db.type/string
                             :db/doc       "Organization name"}
   :organization/default?   {:db/valueType :db.type/boolean
                             :db/doc       "Whether this organization is the default landing organization"}
   :organization/created-at {:db/valueType :db.type/instant
                             :db/doc       "Creation timestamp"}

   ;; -- Workspace -------------------------------------------------------------
   :workspace/id            {:db/valueType :db.type/uuid
                             :db/unique    :db.unique/identity
                             :db/doc       "Unique workspace identifier"}
   :workspace/organization  {:db/valueType :db.type/ref
                             :db/doc       "Parent organization"}
   :workspace/name          {:db/valueType :db.type/string
                             :db/doc       "Workspace name"}
   :workspace/repository    {:db/valueType :db.type/string
                             :db/doc       "Repository path, URL, or identifier"}
   :workspace/created-at    {:db/valueType :db.type/instant
                             :db/doc       "Creation timestamp"}

   ;; -- Sprint ----------------------------------------------------------------
   :sprint/id               {:db/valueType :db.type/uuid
                             :db/unique    :db.unique/identity
                             :db/doc       "Unique sprint identifier"}
   :sprint/organization     {:db/valueType :db.type/ref
                             :db/doc       "Parent organization"}
   :sprint/name             {:db/valueType :db.type/string
                             :db/doc       "Sprint name"}
   :sprint/start-date       {:db/valueType :db.type/instant
                             :db/doc       "Sprint start date"}
   :sprint/end-date         {:db/valueType :db.type/instant
                             :db/doc       "Sprint end date"}
   :sprint/created-at       {:db/valueType :db.type/instant
                             :db/doc       "Creation timestamp"}

   ;; -- Milestone -------------------------------------------------------------
   :milestone/id            {:db/valueType :db.type/uuid
                             :db/unique    :db.unique/identity
                             :db/doc       "Unique milestone identifier"}
   :milestone/sprint        {:db/valueType :db.type/ref
                             :db/doc       "Parent sprint"}
   :milestone/name          {:db/valueType :db.type/string
                             :db/doc       "Milestone name"}
   :milestone/created-at    {:db/valueType :db.type/instant
                             :db/doc       "Creation timestamp"}

   ;; -- Ticket ----------------------------------------------------------------
   :ticket/id                       {:db/valueType :db.type/uuid
                                     :db/unique    :db.unique/identity
                                     :db/doc       "Unique ticket identifier"}
   :ticket/organization             {:db/valueType :db.type/ref
                                     :db/doc       "Owning organization"}
   :ticket/type                     {:db/valueType :db.type/keyword
                                     :db/doc       "Business ticket type keyword"}
   :ticket/title                    {:db/valueType :db.type/string
                                     :db/doc       "Short ticket title for board cards and headings"}
   :ticket/description              {:db/valueType :db.type/string
                                     :db/doc       "Detailed ticket description body text"}
   :ticket/acceptance-criteria-edn  {:db/valueType :db.type/string
                                     :db/doc       "EDN-encoded nested acceptance criteria"}
   :ticket/story-points             {:db/valueType :db.type/long
                                     :db/doc       "Story points"}
   :ticket/effort                   {:db/valueType :db.type/long
                                     :db/doc       "Effort score 0-10"}
   :ticket/impact                   {:db/valueType :db.type/long
                                     :db/doc       "Impact score 0-10"}
   :ticket/status                   {:db/valueType :db.type/keyword
                                     :db/doc       "Ticket lifecycle status: open, in-progress, closed"}
   :ticket/assignee                 {:db/valueType :db.type/string
                                     :db/doc       "Business assignee identifier"}
   :ticket/sprint                   {:db/valueType :db.type/ref
                                     :db/doc       "Direct sprint assignment"}
   :ticket/milestone                {:db/valueType :db.type/ref
                                     :db/doc       "Milestone assignment"}
   :ticket/created-at               {:db/valueType :db.type/instant
                                     :db/doc       "Creation timestamp"}

   ;; -- Attachment ------------------------------------------------------------
   :attachment/id          {:db/valueType :db.type/uuid
                            :db/unique    :db.unique/identity
                            :db/doc       "Unique attachment identifier"}
   :attachment/ticket      {:db/valueType :db.type/ref
                            :db/doc       "Parent ticket"}
   :attachment/name        {:db/valueType :db.type/string
                            :db/doc       "Attachment file name"}
   :attachment/content-type {:db/valueType :db.type/string
                             :db/doc       "Attachment content type"}
   :attachment/size        {:db/valueType :db.type/long
                            :db/doc       "Attachment size in bytes"}
   :attachment/data        {:db/valueType :db.type/bytes
                            :db/doc       "Attachment bytes"}
   :attachment/created-at  {:db/valueType :db.type/instant
                            :db/doc       "Creation timestamp"}

   ;; -- AI Task ---------------------------------------------------------------
   :task/id                {:db/valueType :db.type/uuid
                            :db/unique    :db.unique/identity
                            :db/doc       "Unique task identifier"}
   :task/ticket            {:db/valueType :db.type/ref
                            :db/doc       "Parent ticket"}
   :task/workspace         {:db/valueType :db.type/ref
                            :db/doc       "Workspace context"}
   :task/description       {:db/valueType :db.type/string
                            :db/doc       "Delegated task description"}
   :task/status            {:db/valueType :db.type/keyword
                            :db/doc       "Task lifecycle status"}
   :task/created-at                {:db/valueType :db.type/instant
                                    :db/doc       "Creation timestamp"}
   :task/acceptance-criteria-edn  {:db/valueType :db.type/string
                                    :db/doc       "EDN-encoded scoped acceptance criteria for this task"}
   :task/cove-questions-edn       {:db/valueType :db.type/string
                                    :db/doc       "EDN-encoded CoVe verification questions"}
   :task/depends-on               {:db/valueType   :db.type/ref
                                    :db/cardinality :db.cardinality/many
                                    :db/doc         "Tasks that must complete before this task can start"}

   ;; -- Notification ----------------------------------------------------------
   :notification/id          {:db/valueType :db.type/uuid
                              :db/unique    :db.unique/identity
                              :db/doc       "Unique notification identifier"}
   :notification/organization {:db/valueType :db.type/ref
                               :db/doc       "Owning organization"}
   :notification/task        {:db/valueType :db.type/ref
                              :db/doc       "Referenced task"}
   :notification/status      {:db/valueType :db.type/keyword
                              :db/doc       "Task status that triggered the notification"}
   :notification/created-at  {:db/valueType :db.type/instant
                              :db/doc       "Creation timestamp"}

   ;; -- OpenCode Run ----------------------------------------------------------
   :opencode-run/id          {:db/valueType :db.type/uuid
                              :db/unique    :db.unique/identity
                              :db/doc       "Unique run identifier"}
   :opencode-run/task        {:db/valueType :db.type/ref
                              :db/doc       "Parent task"}
   :opencode-run/pid         {:db/valueType :db.type/long
                              :db/doc       "Observed external process id"}
   :opencode-run/command-edn {:db/valueType :db.type/string
                              :db/doc       "EDN-encoded command vector"}
   :opencode-run/log-path    {:db/valueType :db.type/string
                              :db/doc       "Path to captured logs"}
   :opencode-run/exit-path   {:db/valueType :db.type/string
                              :db/doc       "Path to captured exit code"}
   :opencode-run/working-directory {:db/valueType :db.type/string
                                    :db/doc       "Process working directory"}
   :opencode-run/created-at  {:db/valueType :db.type/instant
                              :db/doc       "Creation timestamp"}

   ;; -- Git Repo ----------------------------------------------------------------
   :git.repo/id              {:db/valueType :db.type/uuid
                              :db/unique    :db.unique/identity
                              :db/doc       "Unique git repository identifier"}
   :git.repo/workspace       {:db/valueType :db.type/ref
                              :db/doc       "Parent workspace that owns this repository"}
   :git.repo/origin-url      {:db/valueType :db.type/string
                              :db/doc       "Remote origin URL (HTTPS or SSH)"}
   :git.repo/default-branch  {:db/valueType :db.type/string
                              :db/doc       "Default branch name (e.g. main, master)"}
   :git.repo/stats-edn       {:db/valueType :db.type/string
                              :db/doc       "EDN-encoded aggregate statistics snapshot (commit count, contributor count, etc.)"}
   :git.repo/knowledge-edn   {:db/valueType :db.type/string
                              :db/doc       "EDN-encoded AI-generated knowledge summarizations about the repository"}
   :git.repo/created-at      {:db/valueType :db.type/instant
                              :db/doc       "Creation timestamp"}

   ;; -- Git Author -------------------------------------------------------------
   :git.author/id            {:db/valueType :db.type/uuid
                              :db/unique    :db.unique/identity
                              :db/doc       "Unique git author identifier"}
   :git.author/name          {:db/valueType :db.type/string
                              :db/doc       "Author display name from git config"}
   :git.author/email         {:db/valueType :db.type/string
                              :db/unique    :db.unique/identity
                              :db/doc       "Author email — identity key for deduplication across commits"}

   ;; -- Git Worktree -----------------------------------------------------------
   :git.worktree/id          {:db/valueType :db.type/uuid
                              :db/unique    :db.unique/identity
                              :db/doc       "Unique git worktree identifier"}
   :git.worktree/repo        {:db/valueType :db.type/ref
                              :db/doc       "Parent git.repo this worktree belongs to"}
   :git.worktree/path        {:db/valueType :db.type/string
                              :db/doc       "Absolute filesystem path of the worktree checkout"}
   :git.worktree/branch      {:db/valueType :db.type/string
                              :db/doc       "Branch currently checked out in this worktree"}
   :git.worktree/main?       {:db/valueType :db.type/boolean
                              :db/doc       "Whether this is the main worktree (vs a linked worktree)"}
   :git.worktree/created-at  {:db/valueType :db.type/instant
                              :db/doc       "Creation timestamp"}

   ;; -- Git Commit --------------------------------------------------------------
   :git.commit/id            {:db/valueType :db.type/uuid
                              :db/unique    :db.unique/identity
                              :db/doc       "Unique git commit identifier"}
   :git.commit/repo          {:db/valueType :db.type/ref
                              :db/doc       "Parent git.repo this commit belongs to"}
   :git.commit/sha           {:db/valueType :db.type/string
                              :db/unique    :db.unique/identity
                              :db/doc       "Full 40-char hex SHA — unique across all repos"}
   :git.commit/message       {:db/valueType :db.type/string
                              :db/doc       "Commit message (first line + body)"}
   :git.commit/author        {:db/valueType :db.type/ref
                              :db/doc       "Ref to git.author entity"}
   :git.commit/authored-at   {:db/valueType :db.type/instant
                              :db/doc       "Author timestamp from git log"}
   :git.commit/parent        {:db/valueType   :db.type/ref
                              :db/cardinality :db.cardinality/many
                              :db/doc         "Parent commit(s) — cardinality/many for merge commits"}
   :git.commit/branch        {:db/valueType :db.type/string
                              :db/doc       "Branch name at time of observation"}})
