import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BUILD_STYLES,
  DEFAULT_BUILD_STYLE,
  type BuildStyle,
  type Project,
} from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../../api/projects.ts';
import { Segmented } from '../../ui/Segmented.tsx';

const LABELS: Record<BuildStyle, string> = { off: 'Off', lite: 'Lite', lean: 'Lean' };

const HINTS: Record<BuildStyle, string> = {
  off: 'Builders work as usual.',
  lite: 'Builders build everything asked and name a leaner option.',
  lean: 'Builders reuse, use the standard library and native features first, and mark shortcuts with lean: comments. Validation, security and accessibility are never trimmed.',
};

export function BuildStyleControl({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (buildStyle: BuildStyle) => projectsApi.setBuildStyle(project.id, buildStyle),
    onSuccess: (updated) => {
      queryClient.setQueryData<Project[]>(projectKeys.all, (projects) =>
        projects?.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
    },
  });
  const current = (save.isPending ? save.variables : project.buildStyle) ?? DEFAULT_BUILD_STYLE;
  return (
    <div className="build-style">
      <span className="build-style-t">Build style</span>
      <Segmented
        ariaLabel={`Build style for ${project.name}`}
        options={BUILD_STYLES.map((style) => ({ id: style, label: LABELS[style] }))}
        value={current}
        onChange={(id) => save.mutate(id as BuildStyle)}
      />
      <p className="allow-note" aria-live="polite">
        {save.isError ? save.error.message : HINTS[current]}
      </p>
    </div>
  );
}
