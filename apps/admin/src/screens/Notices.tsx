import { Content } from './Content.js';

/**
 * 공통 안내.
 * 대기·중단 화면 문구를 한 곳에서 관리한다. 단계마다 복제하지 않는다.
 */
export function Notices(): JSX.Element {
  return (
    <>
      <Content scope="COMMON" tabParam={null} />
    </>
  );
}
