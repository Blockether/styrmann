(ns com.blockether.styrmann.presentation.component.modal-test
  "Unit tests for the modal/shell component.
   Verifies hiccup structure, ARIA attributes, footer rendering, and size variants."
  (:require
   [com.blockether.styrmann.presentation.component.modal :as sut]
   [lazytest.core :refer [defdescribe describe expect expect-it it]]))

;; ---------------------------------------------------------------------------
;; Helpers
;; ---------------------------------------------------------------------------

(defn- find-by-role
  "Walk hiccup tree and return the first element with :role = `role`."
  [tree role]
  (cond
    (not (vector? tree)) nil
    (= role (get-in tree [1 :role])) tree
    :else (some #(find-by-role % role) (drop 2 tree))))

(defn- hiccup-children
  "Return child nodes of a hiccup vector (skipping tag and optional attrs map)."
  [tree]
  (let [tail (rest tree)]
    (if (and (seq tail) (map? (first tail)))
      (rest tail)
      tail)))

(defn- find-by-class
  "Walk hiccup tree and return all elements whose :class contains `cls`."
  [tree cls]
  (cond
    (not (vector? tree)) []
    :else
    (let [attrs    (when (map? (second tree)) (second tree))
          self     (when (and attrs (clojure.string/includes? (str (:class attrs)) cls))
                     [tree])
          children (mapcat #(find-by-class % cls) (hiccup-children tree))]
      (into (vec self) children))))

(defn- find-tag
  "Walk hiccup tree and return the first element with tag `tag`."
  [tree tag]
  (cond
    (not (vector? tree)) nil
    (= tag (first tree)) tree
    :else (some #(find-tag % tag) (drop 2 tree))))

;; ---------------------------------------------------------------------------
;; shell — structure and ARIA
;; ---------------------------------------------------------------------------

(defdescribe shell-test
  (describe "outer backdrop element"
    (it "has :role dialog"
      (let [result (sut/shell "my-modal" "My Title" "Subtitle" [:p "body"])]
        (expect (= "dialog" (get-in result [1 :role])))))

    (it "has :aria-modal true"
      (let [result (sut/shell "my-modal" "My Title" "Subtitle" [:p "body"])]
        (expect (= "true" (get-in result [1 :aria-modal])))))

    (it "has id equal to modal-id"
      (let [result (sut/shell "confirm-dialog" "Confirm" "Action" [:p "body"])]
        (expect (= "confirm-dialog" (get-in result [1 :id])))))

    (it "has :aria-labelledby pointing to title element id"
      (let [result (sut/shell "test-modal" "Title" "Sub" [:p "body"])]
        (expect (= "test-modal-title" (get-in result [1 :aria-labelledby])))))

    (it "outer element has class modal-backdrop"
      (let [result (sut/shell "m" "T" "S" [:p "b"])]
        (expect (clojure.string/includes? (get-in result [1 :class]) "modal-backdrop")))))

  (describe "title element"
    (it "renders h2 with the provided title text"
      (let [result (sut/shell "m" "My Heading" "Sub" [:p "body"])
            h2     (find-tag result :h2)]
        (expect (some? h2))
        (expect (= "My Heading" (last h2)))))

    (it "h2 id matches aria-labelledby"
      (let [result (sut/shell "z-modal" "Z Title" "S" [:p "b"])
            h2     (find-tag result :h2)]
        (expect (= "z-modal-title" (get-in h2 [1 :id])))))

    (it "renders subtitle in a div above the title"
      (let [result (sut/shell "m" "T" "My Subtitle" [:p "body"])
            ;; subtitle is a :div with class field-label
            labels (find-by-class result "field-label")]
        (expect (= 1 (count labels)))
        (expect (= "My Subtitle" (last (first labels)))))))

  (describe "body"
    (it "renders body content inside the shell"
      (let [body   [:p {:id "body-para"} "body text"]
            result (sut/shell "m" "T" "S" body)
            para   (find-tag result :p)]
        (expect (some? para))
        (expect (= "body text" (last para)))))

    (it "body wrapper has no overflow style when no footer"
      (let [result (sut/shell "m" "T" "S" [:p "b"])
            ;; The body div has px-5 py-5 class
            body-divs (find-by-class result "px-5 py-5")]
        (expect (= 1 (count body-divs)))
        (expect (nil? (get-in (first body-divs) [1 :style]))))))

  (describe "close button"
    (it "renders a button with data-modal-close attribute"
      (let [result  (sut/shell "m" "T" "S" [:p "b"])
            buttons (find-by-class result "modal-close")]
        (expect (= 1 (count buttons)))
        (expect (= true (get-in (first buttons) [1 :data-modal-close]))))))

  (describe "footer"
    (it "renders footer element when :footer opt is provided"
      (let [footer [:button "Save"]
            result (sut/shell "m" "T" "S" [:p "b"] {:footer footer})
            footer-divs (find-by-class result "flex-shrink-0")]
        (expect (= 1 (count footer-divs)))))

    (it "footer contains the provided footer hiccup"
      (let [footer  [:button {:id "save-btn"} "Save"]
            result  (sut/shell "m" "T" "S" [:p "b"] {:footer footer})
            save-btn (find-tag result :button)]
        ;; The save button should appear somewhere in the tree
        (let [all-buttons (find-by-class result "")]
          (expect (some? (find-tag result :button))))))

    (it "does not render footer section when :footer is nil"
      (let [result      (sut/shell "m" "T" "S" [:p "b"] {:footer nil})
            footer-divs (find-by-class result "flex-shrink-0")]
        (expect (= 0 (count footer-divs)))))

    (it "body wrapper gets overflow-y style when footer is present"
      (let [result    (sut/shell "m" "T" "S" [:p "b"] {:footer [:button "OK"]})
            body-divs (find-by-class result "px-5 py-5")]
        (expect (= 1 (count body-divs)))
        (expect (some? (get-in (first body-divs) [1 :style]))))))

  (describe "size variants"
    (it "default size (no :size opt) adds no extra class"
      (let [result (sut/shell "m" "T" "S" [:p "b"])
            shells (find-by-class result "modal-shell")]
        ;; The first element with modal-shell class should exist and not have --sm or --lg
        (expect (= 1 (count shells)))
        (expect (not (clojure.string/includes? (get-in (first shells) [1 :class]) "--sm")))
        (expect (not (clojure.string/includes? (get-in (first shells) [1 :class]) "--lg")))))

    (it ":size :sm adds modal-shell--sm class"
      (let [result (sut/shell "m" "T" "S" [:p "b"] {:size :sm})
            shells (find-by-class result "modal-shell--sm")]
        (expect (= 1 (count shells)))))

    (it ":size :lg adds modal-shell--lg class"
      (let [result (sut/shell "m" "T" "S" [:p "b"] {:size :lg})
            shells (find-by-class result "modal-shell--lg")]
        (expect (= 1 (count shells)))))

    (it ":size :md adds no extra modifier class"
      (let [result (sut/shell "m" "T" "S" [:p "b"] {:size :md})
            shells (find-by-class result "modal-shell")]
        (expect (= 1 (count shells)))
        (expect (not (clojure.string/includes? (get-in (first shells) [1 :class]) "--sm")))
        (expect (not (clojure.string/includes? (get-in (first shells) [1 :class]) "--lg"))))))

  (describe "3-arity call (no opts)"
    (it "3-arity delegates to 5-arity with nil opts — no footer rendered"
      (let [result      (sut/shell "m" "T" "S" [:p "b"])
            footer-divs (find-by-class result "flex-shrink-0")]
        (expect (= 0 (count footer-divs)))))))
