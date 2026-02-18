import MouseReveal from "./components/MouseReveal";

export default function App(): JSX.Element {
  return (
    <main className="app-shell" aria-label="Interactive mouse reveal scene">
      <MouseReveal />
    </main>
  );
}
