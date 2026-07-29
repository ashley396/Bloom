import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { fadeUp } from "../../lib/motion";
import { cn } from "../../lib/utils";

type FadeInProps = {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
};

export function FadeIn({ children, className, as = "div" }: FadeInProps) {
  const reduce = useReducedMotion();
  const Comp = motion[as];

  if (reduce) {
    const Static = as;
    return <Static className={className}>{children}</Static>;
  }

  return (
    <Comp
      className={cn(className)}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
      variants={fadeUp}
    >
      {children}
    </Comp>
  );
}
