/**
 * Small DOM helpers shared across Bloom features.
 * Keeping these in one place makes future feature modules easier to maintain.
 */
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
