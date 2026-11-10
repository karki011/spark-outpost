import type { ReactNode } from 'react';

interface HomeLayoutProps {
  entering: boolean;
  loading: boolean;
  header: ReactNode;
  lead: ReactNode;
  composer: ReactNode;
  board: ReactNode;
  foot: ReactNode;
}

export function HomeLayout(props: HomeLayoutProps) {
  return (
    <main className="page" aria-labelledby="home-greet">
      <div className="home">
        <div className={props.entering ? 'home-wrap home-live enter' : 'home-wrap home-live'}>
          {props.header}
          <div className="home-lead" aria-busy={props.loading}>
            {props.lead}
          </div>
          {props.composer}
          <div className="home-board" aria-busy={props.loading}>
            {props.board}
          </div>
          {props.foot}
        </div>
      </div>
    </main>
  );
}
