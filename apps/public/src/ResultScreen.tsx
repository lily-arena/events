import { useEffect, useState } from 'react';
import { blockItems, blockText } from '@first-seat/content';
import type { Campaign } from '@first-seat/domain';
import { ApiError, fetchResult, type ResultDto } from './api.js';

/**
 * Phase 3 결과. result_versions의 선정값을 렌더링하며 콘텐츠 편집으로 바꾸지 않는다.
 * 결과 공개와 좌석 설치 완료를 혼동하지 않는다. 이름·연락처는 공개하지 않는다.
 */
export function ResultScreen({ campaign }: { campaign: Campaign }): JSX.Element {
  const blocks = campaign.content.blocks;
  const [result, setResult] = useState<ResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchResult();
        if (!cancelled) setResult(data);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof ApiError ? loadError.body.message : '잠시 후 다시 시도해주세요.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <div className="state-screen">
        <p>{error}</p>
      </div>
    );
  }
  if (result === null) {
    return (
      <div className="state-screen" aria-busy="true">
        <div className="skeleton" style={{ width: '60%' }} />
      </div>
    );
  }

  return (
    <>
      <h1 className="hero">{blockText(blocks, 'hero')}</h1>
      <div className="intro">
        {blockItems(blocks, 'intro').map((item, index) => (
          <p className={index === 0 ? 'lead' : undefined} key={index}>
            {item}
          </p>
        ))}
      </div>

      <section aria-label="선정 문구">
        <blockquote className="winner">{result.winnerMessage}</blockquote>
      </section>

      {result.media.length > 0 && (
        <section aria-label="설치 사진">
          {result.media.map((item) => (
            <figure key={item.assetPath} className="result-media">
              <img src={item.assetPath} alt={item.alt} />
              <figcaption>{item.caption}</figcaption>
            </figure>
          ))}
        </section>
      )}

      <p className="helper">
        결과 발표일 {new Date(result.publishedAt).toLocaleDateString('ko-KR')}
        {result.correctionNote !== null && ` · 정정: ${result.correctionNote}`}
      </p>
    </>
  );
}
