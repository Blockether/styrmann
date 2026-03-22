;; Script: close-tickets.clj | Author: spel-automator | Date: 2026-03-18 | Args: <base-url> <org-id> <ticket-id>...
;; Usage: spel eval-sci spel-scripts/close-tickets.clj -- <base-url> <org-id> <tid1> [tid2] [tid3] ...
;;
;; Closes one or more tickets by navigating to each ticket's detail page and
;; clicking the "Close directly" button. Saves a screenshot per ticket to
;; /tmp/styrmann-screenshots/ticket-N-closed.png and a final board screenshot.

(let [args *command-line-args*
      base-url (first args)
      org-id (second args)
      ticket-ids (drop 2 args)]

  (when (or (not base-url) (not org-id) (empty? ticket-ids))
    (throw (ex-info "Usage: spel eval-sci close-tickets.clj -- <base-url> <org-id> <tid1> [tid2] ..."
                    {:reason :bad-input})))

  (doseq [[idx tid] (map-indexed vector ticket-ids)]
    (let [ticket-num (inc idx)
          ticket-url (str base-url "/organizations/" org-id "/tickets/" tid)
          screenshot-path (str "/tmp/styrmann-screenshots/ticket-" ticket-num "-closed.png")]

      (println (str "\n=== Ticket " ticket-num " (" tid ") ==="))
      (println (str "Navigating to: " ticket-url))

      ;; Navigate to ticket
      (let [result (page/navigate @!page ticket-url)]
        (when (:anomaly/category result)
          (throw (ex-info (str "Navigation failed for ticket " ticket-num)
                          {:reason :navigation-failed
                           :message (:anomaly/message result)}))))

      (Thread/sleep 2000)

      ;; Click the "Close directly" button
      (let [close-btn (page/locator @!page "button[title='Close directly']")]
        (println "Clicking 'Close directly' button...")
        (locator/click close-btn))

      (Thread/sleep 2000)

      ;; Verify the ticket is now closed
      (let [snap (page/accessibility-snapshot @!page)
            tree (str (:tree snap))]
        (if (clojure.string/includes? tree "closed")
          (println (str "Ticket " ticket-num " successfully closed."))
          (println (str "WARNING: Could not verify ticket " ticket-num " is closed.")))

        (when (clojure.string/includes? tree "Reopen")
          (println (str "Verified: 'Reopen ticket' button visible."))))

      ;; Take screenshot
      (page/screenshot @!page {:path screenshot-path})
      (println (str "Screenshot saved: " screenshot-path))))

  ;; Navigate to the organization board for a final screenshot
  (let [board-url (str base-url "/organizations/" org-id)]
    (println (str "\n=== Organization board ==="))

    (let [result (page/navigate @!page board-url)]
      (when (:anomaly/category result)
        (throw (ex-info "Navigation to board failed"
                        {:reason :navigation-failed
                         :message (:anomaly/message result)}))))

    (Thread/sleep 2000)

    (page/screenshot @!page {:path "/tmp/styrmann-screenshots/board-all-closed.png"})
    (println "Board screenshot saved: /tmp/styrmann-screenshots/board-all-closed.png"))

  (println "\n=== Done. All tickets processed. ==="))
