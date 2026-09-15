/**
 * 왼쪽 메뉴.
 * 번호나 진행률을 쓰지 않는다. 인증된 담당자는 모든 메뉴를 쓴다.
 */

export interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly desc: string;
}

export interface NavGroup {
  readonly title: string;
  readonly items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: '전체',
    items: [{ path: '/dashboard', label: '대시보드', desc: '현재 공개 단계와 다음 전환을 확인합니다.' }],
  },
  {
    title: '공모 운영',
    items: [
      { path: '/submission/content', label: '화면 문구', desc: '공모 화면과 접수 완료 화면의 문구를 고칩니다.' },
      { path: '/submission/review', label: '응모작 심사', desc: '접수된 문구를 검토하고 후보를 지정합니다.' },
    ],
  },
  {
    title: '투표 운영',
    items: [
      { path: '/voting/candidates', label: '숏리스트', desc: '후보로 지정한 문구를 확인하고 확정합니다.' },
      { path: '/voting/content', label: '화면 문구', desc: '투표 화면과 투표 완료 화면의 문구를 고칩니다.' },
      { path: '/voting/monitor', label: '투표 현황', desc: '득표순으로 투표수를 확인합니다.' },
    ],
  },
  {
    title: '결과 운영',
    items: [
      { path: '/results/final', label: '최종 문구 선정', desc: '후보 중 하나를 골라 최종 문구로 확정합니다.' },
      { path: '/results/content', label: '화면 문구', desc: '결과 발표 화면의 문구와 사진을 고칩니다.' },
    ],
  },
  {
    title: '관리',
    items: [
      { path: '/settings/notices', label: '공통 안내', desc: '대기·중단 안내 문구를 고칩니다.' },
      { path: '/settings/audit', label: '운영 기록', desc: '누가 무엇을 바꿨는지 확인합니다.' },
      { path: '/settings/privacy', label: '개인정보', desc: '가려진 정보 확인, 원문 보기, 파기를 처리합니다.' },
    ],
  },
];

export function findItem(path: string): NavItem | null {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.path === path) return item;
    }
  }
  return null;
}

export function visibleGroups(): readonly NavGroup[] {
  return NAV_GROUPS;
}

export function canAccess(path: string): boolean {
  return findItem(path) !== null;
}

export const DEFAULT_PATH = '/dashboard';
