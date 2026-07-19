import type { Metadata } from "next";
import FirstAndTen from "./FirstAndTen";

export const metadata: Metadata = {
  title: "First & Ten — Football Card Game Scorekeeper",
  description: "A mobile-friendly companion for the two-player First & Ten football card game.",
};

export default function Home() { return <FirstAndTen />; }
