export class ParkedTurns {
  private readonly quitters = new Set<() => void>();

  park(onQuit: () => void): () => void {
    const quitter = () => onQuit();
    this.quitters.add(quitter);
    return () => {
      this.quitters.delete(quitter);
    };
  }

  quit(): number {
    const stopping = [...this.quitters];
    this.quitters.clear();
    for (const stop of stopping) stop();
    return stopping.length;
  }
}
