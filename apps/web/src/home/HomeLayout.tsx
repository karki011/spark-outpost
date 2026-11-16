import type { ReactNode } from 'react';

interface HomeLayoutProps {
  entering: boolean;
  loading: boolean;
  header: ReactNode;
  composer: ReactNode;
  children: ReactNode;
  foot: ReactNode;
}

export function HomeLayout(props: HomeLayoutProps) {
  return (
    <main className="page" aria-labelledby="home-greet">
      <div className="home">
        <div className={props.entering ? 'home-wrap home-live enter' : 'home-wrap home-live'}>
          {props.header}
          {props.composer}
          <div className="home-sections" aria-busy={props.loading}>
            {props.children}
          </div>
          {props.foot}
        </div>
      </div>
    </main>
  );
}
