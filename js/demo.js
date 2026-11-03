// Пример набора: открывается без обращения к Claude, чтобы было видно, как выглядит результат.
(function () {
  'use strict';
  const ok = { status: 'ok', note: '' };
  const q = (test, pos, level, text, figure, options, correct, solution, extra) => Object.assign({
    id: 'demo' + test + pos, test, pos, level, text, figure,
    figType: figure ? 'stem' : (options.some(o => o.figure) ? 'options' : 'none'),
    options: options.map(o => (typeof o === 'string' ? { text: o, figure: null } : o)),
    correct, solution, qa: ok
  }, extra || {});
  const tri = (pts, els, more) => Object.assign({ view: 'plane', points: pts, elements: els }, more || {});

  function demoSet() {
    const questions = [
      q(1, 0, 'easy', 'Тікбұрышты үшбұрыштың катеттері 6 см және 8 см. Үшбұрыштың ауданын табыңыз.',
        tri({ C: [0, 0], A: [0, 6], B: [8, 0] }, [{ type: 'polygon', points: ['A', 'B', 'C'], fill: 'accent' }, { type: 'right', at: 'C', from: 'A', to: 'B' }, { type: 'segment', from: 'C', to: 'A', label: '6 см' }, { type: 'segment', from: 'C', to: 'B', label: '8 см' }, { type: 'text', at: [2.4, 2], text: 'S = ?', color: 'accent' }]),
        ['48 см^2^', '24 см^2^', '14 см^2^', '28 см^2^', '12 см^2^'], 1, 'S = ½·6·8 = 24 см^2^.'),
      q(1, 1, 'medium', 'Суретте ABC үшбұрышы берілген: AB = 8 см, AC = 6 см, ∠A = 30°. Үшбұрыштың ауданын табыңыз.',
        tri({ A: [0, 0], B: [8, 0], C: { polar: ['A', 6, 30] } }, [{ type: 'polygon', points: ['A', 'B', 'C'] }, { type: 'segment', from: 'A', to: 'B', label: '8 см' }, { type: 'segment', from: 'A', to: 'C', label: '6 см' }, { type: 'angle', at: 'A', from: 'B', to: 'C', label: '30°' }]),
        ['24 см^2^', '12√3 см^2^', '6 см^2^', '12 см^2^', '48 см^2^'], 3, 'S = ½·AB·AC·sin A = ½·8·6·½ = 12 см^2^.'),
      q(1, 2, 'medium', 'Үшбұрыштың табаны 10 см, оған түсірілген биіктігі 7 см. Үшбұрыштың ауданын табыңыз.',
        tri({ A: [0, 0], C: [10, 0], B: [3, 7], H: { foot: ['B', 'A', 'C'] } }, [{ type: 'polygon', points: ['A', 'B', 'C'] }, { type: 'segment', from: 'B', to: 'H', dashed: true, label: '7 см' }, { type: 'right', at: 'H', from: 'B', to: 'C' }, { type: 'segment', from: 'A', to: 'C', label: '10 см' }]),
        ['70 см^2^', '17 см^2^', '35 см^2^', '17,5 см^2^', '3,5 см^2^'], 2, 'S = ½·10·7 = 35 см^2^.'),
      q(1, 3, 'hard', 'Теңбүйірлі үшбұрыштың бүйір қабырғасы 10 см, табаны 12 см. Үшбұрыштың ауданын табыңыз.',
        tri({ A: [0, 0], C: [12, 0], B: [6, 8], H: { mid: ['A', 'C'] } }, [{ type: 'polygon', points: ['A', 'B', 'C'] }, { type: 'segment', from: 'A', to: 'B', label: '10 см', ticks: 1 }, { type: 'segment', from: 'B', to: 'C', ticks: 1 }, { type: 'segment', from: 'A', to: 'C', label: '12 см' }, { type: 'segment', from: 'B', to: 'H', dashed: true, color: 'aux' }]),
        ['60 см^2^', '96 см^2^', '120 см^2^', '40 см^2^', '48 см^2^'], 4, 'Биіктік табанның ортасына түседі: h = √(10^2^ − 6^2^) = 8 см. S = ½·12·8 = 48 см^2^.'),
      q(1, 4, 'super', 'ABC үшбұрышында K нүктесі AB қабырғасын AK : KB = 1 : 2 қатынасында бөледі, M — BC қабырғасының ортасы. ABC үшбұрышының ауданы 36 см^2^. KBM үшбұрышының ауданын табыңыз.',
        tri({ A: [0, 0], B: [4, 6], C: [10, 0], K: { ratio: ['A', 'B', 1, 2] }, M: { mid: ['B', 'C'] } }, [{ type: 'polygon', points: ['A', 'B', 'C'] }, { type: 'polygon', points: ['K', 'B', 'M'], fill: 'accent', color: 'accent' }, { type: 'segment', from: 'B', to: 'M', ticks: 1 }, { type: 'segment', from: 'M', to: 'C', ticks: 1 }], { dots: ['K', 'M'] }),
        ['12 см^2^', '18 см^2^', '9 см^2^', '24 см^2^', '6 см^2^'], 0, 'S(KBM) = (KB/AB)·(BM/BC)·S(ABC) = (2/3)·(1/2)·36 = 12 см^2^.'),

      q(2, 0, 'easy', 'Қай суретте тікбұрышты үшбұрыш бейнеленген?', null, [
        { text: '', figure: tri({ A: [0, 0], B: [5, 0], C: [1.5, 3] }, [{ type: 'polygon', points: ['A', 'B', 'C'] }], { labels: false }) },
        { text: '', figure: tri({ A: [0, 0], B: [5, 0], C: [5, 3] }, [{ type: 'polygon', points: ['A', 'B', 'C'] }, { type: 'right', at: 'B', from: 'A', to: 'C' }], { labels: false }) },
        { text: '', figure: tri({ A: [0, 0], B: [5, 0], C: [-1, 2.4] }, [{ type: 'polygon', points: ['A', 'B', 'C'] }], { labels: false }) },
        { text: '', figure: tri({ A: [0, 0], B: [5, 0], C: [2.5, 4.3] }, [{ type: 'polygon', points: ['A', 'B', 'C'] }], { labels: false }) },
        { text: '', figure: tri({ A: [0, 0], B: [5, 0], C: [3.8, 1.2] }, [{ type: 'polygon', points: ['A', 'B', 'C'] }], { labels: false }) }
      ], 1, 'Тік бұрыш белгісі тек B суретінде бар.'),
      q(2, 1, 'medium', 'Үшбұрыштың қабырғалары 13 см, 14 см және 15 см. Үшбұрыштың ауданын табыңыз.',
        tri({ A: [0, 0], C: [14, 0], B: [5, 12] }, [{ type: 'polygon', points: ['A', 'B', 'C'] }, { type: 'segment', from: 'A', to: 'B', label: '13 см' }, { type: 'segment', from: 'B', to: 'C', label: '15 см' }, { type: 'segment', from: 'A', to: 'C', label: '14 см' }]),
        ['42 см^2^', '168 см^2^', '84 см^2^', '90 см^2^', '72 см^2^'], 2, 'Герон формуласы: p = 21, S = √(21·8·7·6) = 84 см^2^.'),
      q(2, 2, 'medium', 'ABCD параллелограмында AB = 6 см, AD = 10 см, ∠A = 30°. Параллелограмның ауданын табыңыз.',
        tri({ A: [0, 0], D: [10, 0], B: { polar: ['A', 6, 30] }, C: { parallelogram: ['B', 'A', 'D'] } }, [{ type: 'polygon', points: ['A', 'B', 'C', 'D'] }, { type: 'segment', from: 'A', to: 'B', label: '6 см' }, { type: 'segment', from: 'A', to: 'D', label: '10 см' }, { type: 'angle', at: 'A', from: 'D', to: 'B', label: '30°' }]),
        ['60 см^2^', '30√3 см^2^', '15 см^2^', '16 см^2^', '30 см^2^'], 4, 'S = AB·AD·sin A = 6·10·½ = 30 см^2^.'),
      q(2, 3, 'hard', 'Тікбұрышты үшбұрыштың гипотенузасы 10 см, бір катеті 6 см. Гипотенузаға түсірілген биіктікті табыңыз.',
        tri({ C: [0, 0], A: [0, 6], B: [8, 0], H: { foot: ['C', 'A', 'B'] } }, [{ type: 'polygon', points: ['A', 'B', 'C'] }, { type: 'right', at: 'C', from: 'A', to: 'B' }, { type: 'segment', from: 'C', to: 'A', label: '6 см' }, { type: 'segment', from: 'A', to: 'B', label: '10 см' }, { type: 'segment', from: 'C', to: 'H', color: 'accent', label: '?' }, { type: 'right', at: 'H', from: 'C', to: 'B' }]),
        ['4 см', '4,8 см', '5 см', '2,4 см', '9,6 см'], 1, 'Екінші катет 8 см. h = 6·8 / 10 = 4,8 см.'),
      q(2, 4, 'super', 'Тікбұрышты үшбұрыштың катеттері 5 см және 12 см. Үшбұрышқа іштей сызылған шеңбердің радиусын табыңыз.',
        tri({ C: [0, 0], A: [0, 5], B: [12, 0], O: { incenter: ['A', 'B', 'C'] } }, [{ type: 'polygon', points: ['A', 'B', 'C'] }, { type: 'right', at: 'C', from: 'A', to: 'B' }, { type: 'incircle', points: ['A', 'B', 'C'], color: 'accent' }, { type: 'segment', from: 'C', to: 'A', label: '5 см' }, { type: 'segment', from: 'C', to: 'B', label: '12 см' }], { dots: ['O'] }),
        ['3 см', '2,5 см', '4 см', '2 см', '6 см'], 3, 'Гипотенуза 13 см. r = (5 + 12 − 13) / 2 = 2 см.',
        { qa: { status: 'warn', note: 'Пример замечания проверяющего: на чертеже не подписан радиус r — добавьте подпись «r = ?».' } })
    ];
    return {
      demo: true, grade: 9, lang: 'kk', langName: '', topic: '', videoUrl: '', notes: '', images: [],
      analysis: { topic: 'Үшбұрыштың ауданы (мысал)', summary: '', facts: [], board: [] },
      questions, steps: {}, targetLetters: null, plan: null,
      settings: { solutions: true, imgTag: true, imgTemplate: '[img:{file}]' }
    };
  }
  window.DemoSet = demoSet;
})();
