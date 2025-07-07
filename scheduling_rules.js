/**
 * @file scheduling_rules.js
 * @description 排班規則檢查引擎 (三班制增強版)。
 * 支援平日三班制、假日兩班制、班次間隔規則等新功能。
 * * @version 2.2 - 修正版
 * @fix 修正了 calculateConsecutiveWorkDays 函式，使其從目標日期的前一天開始計算，以解決自動排班的邏輯錯誤。
 */

(function(window) {
    'use strict';

    // 定義規則引擎物件
    const RuleEngine = {};

    // --- 內部輔助函式 ---

    /**
     * 格式化日期為 YYYY-MM-DD 字串
     * @param {Date} date - 日期物件
     * @returns {string} 格式化後的日期字串
     */
    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * 檢查指定日期是否為假日
     * @param {string} dateStr - 日期字串 (YYYY-MM-DD)
     * @param {object} holidayDates - 假日設定物件
     * @returns {boolean} 如果是假日則為 true
     */
    function isHoliday(dateStr, holidayDates) {
        return holidayDates && holidayDates[dateStr] === true;
    }


    // --- 班次定義和輔助函數 ---

    /**
     * 班次順序定義（用於間隔檢查）
     */
    const WEEKDAY_SHIFT_ORDER = ['day', 'evening', 'night'];
    const WEEKEND_SHIFT_ORDER = ['weekend-day', 'weekend-night'];

    /**
     * 獲取班次在順序中的位置
     * @param {string} shiftType - 班次類型
     * @param {boolean} isHoliday - 當天是否為假日
     * @returns {number} 班次在順序陣列中的索引
     */
    function getShiftPosition(shiftType, isHoliday) {
        const order = isHoliday ? WEEKEND_SHIFT_ORDER : WEEKDAY_SHIFT_ORDER;
        return order.indexOf(shiftType);
    }

    /**
     * 檢查兩個班次之間的間隔是否足夠
     */
    function hasEnoughShiftGap(shift1, shift2, isHoliday1, isHoliday2) {
        if (isHoliday1 !== isHoliday2) return true;
        if (shift1 === 'off' || shift2 === 'off') return true;
        if (isHoliday1) return true;
        
        const pos1 = getShiftPosition(shift1, false);
        const pos2 = getShiftPosition(shift2, false);
        
        if (pos1 === -1 || pos2 === -1) return true;
        
        const steps = (pos2 - pos1 + WEEKDAY_SHIFT_ORDER.length) % WEEKDAY_SHIFT_ORDER.length;
        return steps > 1;
    }

    // --- 私有UI輔助函式 ---

    /**
     * 清除所有驗證高亮顯示
     */
    function clearValidationHighlights(calendarGrid) {
        calendarGrid.querySelectorAll('.conflict-cell').forEach(cell => {
            cell.classList.remove('conflict-cell');
        });
        calendarGrid.querySelectorAll('.conflict-indicator').forEach(indicator => {
            indicator.remove();
        });
    }

    /**
     * 高亮顯示衝突日期
     */
    function highlightConflict(calendarGrid, date, reason) {
        const cell = calendarGrid.querySelector(`[data-date="${date}"]`);
        if (!cell) return;
        
        cell.classList.add('conflict-cell');
        
        let indicator = cell.querySelector('.conflict-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'conflict-indicator';
            indicator.innerHTML = '!<div class="conflict-tooltip"></div>';
            cell.appendChild(indicator);
        }
        
        const tooltip = indicator.querySelector('.conflict-tooltip');
        if (tooltip && !tooltip.innerHTML.includes(reason)) {
            tooltip.innerHTML += `• ${reason}<br>`;
        }
    }

    // --- 規則處理函式定義 ---

    /**
     * 檢查最大連續工作天數
     */
    function checkMaxConsecutiveWorkDays(context) {
        const { rule, scheduleData, year, month, calendarGrid } = context;
        const employee = rule.employee;
        const maxDays = parseInt(rule.value, 10);
        let consecutiveCount = 0;
        let conflictCount = 0;

        const startDate = new Date(year, month, 1 - maxDays);
        const endDate = new Date(year, month + 1, 0);

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = formatDate(d);
            const isWorking = (scheduleData[dateStr] || []).some(s => 
                s.employee === employee && s.shift !== 'off'
            );

            if (isWorking) {
                consecutiveCount++;
                if (consecutiveCount > maxDays) {
                    const reason = `${employee} 連續工作第 ${consecutiveCount} 天 (超過限制 ${maxDays} 天)`;
                    if (d.getFullYear() === year && d.getMonth() === month) {
                        conflictCount++;
                        highlightConflict(calendarGrid, dateStr, reason);
                    }
                }
            } else {
                consecutiveCount = 0;
            }
        }
        return conflictCount;
    }

    /**
     * 檢查是否為連續24小時班次
     */
    function checkNo24HourShift(context) {
        const { rule, scheduleData, year, month, calendarGrid, holidayDates } = context;
        const employee = rule.employee;
        let conflictCount = 0;
        
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        for (let day = 1; day <= daysInMonth; day++) {
            const currentDate = new Date(year, month, day);
            const prevDate = new Date(year, month, day - 1);

            const currentDateStr = formatDate(currentDate);
            const prevDateStr = formatDate(prevDate);

            const todayShifts = scheduleData[currentDateStr] || [];
            const prevDayShifts = scheduleData[prevDateStr] || [];

            const currentIsHoliday = isHoliday(currentDateStr, holidayDates);
            const prevIsHoliday = isHoliday(prevDateStr, holidayDates);

            const nightShifts = prevIsHoliday ? ['weekend-night'] : ['night'];
            const dayShifts = currentIsHoliday ? ['weekend-day'] : ['day'];

            const hadNightShift = prevDayShifts.some(s => s.employee === employee && nightShifts.includes(s.shift));
            const hasDayShift = todayShifts.some(s => s.employee === employee && dayShifts.includes(s.shift));

            if (hadNightShift && hasDayShift) {
                conflictCount++;
                const reason = `${employee} 24小時連續工作 (${prevDateStr} 夜班 → ${currentDateStr} 白班)`;
                highlightConflict(calendarGrid, currentDateStr, reason);
                highlightConflict(calendarGrid, prevDateStr, `${employee} 夜班後隔天接白班`);
            }
        }
        
        return conflictCount;
    }

    /**
     * 檢查班次直接銜接規則
     */
    function checkNoDirectShiftTransition(context) {
        const { rule, scheduleData, year, month, calendarGrid, holidayDates } = context;
        const employee = rule.employee;
        let conflictCount = 0;
        
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        for (let day = 1; day <= daysInMonth; day++) {
            const currentDate = new Date(year, month, day);
            const nextDate = new Date(year, month, day + 1);

            const currentDateStr = formatDate(currentDate);
            const nextDateStr = formatDate(nextDate);

            const todayShifts = scheduleData[currentDateStr] || [];
            const tomorrowShifts = scheduleData[nextDateStr] || [];

            const currentIsHoliday = isHoliday(currentDateStr, holidayDates);
            const nextIsHoliday = isHoliday(nextDateStr, holidayDates);

            const todayShift = todayShifts.find(s => s.employee === employee && s.shift !== 'off');
            const tomorrowShift = tomorrowShifts.find(s => s.employee === employee && s.shift !== 'off');

            if (todayShift && tomorrowShift) {
                if (!hasEnoughShiftGap(todayShift.shift, tomorrowShift.shift, currentIsHoliday, nextIsHoliday)) {
                    conflictCount++;
                    const reason = `${employee} 班次間隔不足 (${todayShift.shift} → ${tomorrowShift.shift})`;
                    highlightConflict(calendarGrid, currentDateStr, reason);
                    highlightConflict(calendarGrid, nextDateStr, reason);
                }
            }
        }
        
        return conflictCount;
    }

    /**
     * 檢查每日最少排班人數
     */
    function checkMinStaff(context) {
        const { rule, scheduleData, year, month, shiftTypes, calendarGrid } = context;
        let conflictCount = 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = formatDate(new Date(year, month, day));
            const staffCount = (scheduleData[dateStr] || []).filter(s => s.shift === rule.shift).length;
            
            if (staffCount < rule.value) {
                conflictCount++;
                const reason = `${shiftTypes[rule.shift]} 人數不足 (目前: ${staffCount}, 需要: ${rule.value})`;
                highlightConflict(calendarGrid, dateStr, reason);
            }
        }
        return conflictCount;
    }

    /**
     * 檢查員工白班夜班平衡
     */
    function checkShiftBalance(context) {
        const { rule, scheduleData, year, month, calendarGrid } = context;
        const employee = rule.employee;
        const maxDifference = parseInt(rule.value, 10) || 2;
        let conflictCount = 0;

        let dayShiftCount = 0;
        let nightShiftCount = 0;
        
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = formatDate(new Date(year, month, day));
            const shifts = scheduleData[dateStr] || [];
            
            shifts.forEach(shift => {
                if (shift.employee === employee) {
                    if (shift.shift === 'day' || shift.shift === 'weekend-day') dayShiftCount++;
                    if (shift.shift === 'night' || shift.shift === 'weekend-night') nightShiftCount++;
                }
            });
        }

        const difference = Math.abs(dayShiftCount - nightShiftCount);
        if (difference > maxDifference && (dayShiftCount > 0 || nightShiftCount > 0)) {
            conflictCount++;
            let lastShiftDate = null;
            const dominantShift = dayShiftCount > nightShiftCount ? ['day', 'weekend-day'] : ['night', 'weekend-night'];
            for (let day = daysInMonth; day >= 1; day--) {
                const dateStr = formatDate(new Date(year, month, day));
                if ((scheduleData[dateStr] || []).some(s => s.employee === employee && dominantShift.includes(s.shift))) {
                    lastShiftDate = dateStr;
                    break;
                }
            }
            if (lastShiftDate) {
                const reason = `${employee} 班次不平衡：白班${dayShiftCount}次，夜班${nightShiftCount}次 (差距${difference}，限制${maxDifference})`;
                highlightConflict(calendarGrid, lastShiftDate, reason);
            }
        }
        return conflictCount;
    }

    /**
     * 檢查員工可用性衝突
     */
    function checkEmployeeAvailability(context) {
        const { scheduleData, employeeAvailability, year, month, calendarGrid } = context;
        let conflictCount = 0;
        if (!employeeAvailability) return 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = formatDate(new Date(year, month, day));
            (scheduleData[dateStr] || []).forEach(shift => {
                if (shift.shift !== 'off' && employeeAvailability[shift.employee]?.[dateStr] === false) {
                    conflictCount++;
                    highlightConflict(calendarGrid, dateStr, `${shift.employee} 在此日設定為不可用`);
                }
            });
        }
        return conflictCount;
    }

    /**
     * 檢查員工重複排班
     */
    function checkDuplicateAssignment(context) {
        const { scheduleData, year, month, calendarGrid } = context;
        let conflictCount = 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = formatDate(new Date(year, month, day));
            const shifts = scheduleData[dateStr] || [];
            const employeeShifts = {};
            shifts.forEach(shift => {
                if (shift.shift !== 'off') {
                    if (!employeeShifts[shift.employee]) employeeShifts[shift.employee] = [];
                    employeeShifts[shift.employee].push(shift.shift);
                }
            });
            Object.entries(employeeShifts).forEach(([employee, empShifts]) => {
                if (empShifts.length > 1) {
                    conflictCount++;
                    highlightConflict(calendarGrid, dateStr, `${employee} 在同一天被安排多個班次: ${empShifts.join(', ')}`);
                }
            });
        }
        return conflictCount;
    }

    // --- 規則註冊表 ---
    const employeeRuleHandlers = {
        'maxConsecutiveWorkDays': checkMaxConsecutiveWorkDays,
        'no24HourShift': checkNo24HourShift,
        'noDirectShiftTransition': checkNoDirectShiftTransition,
        'balanceShifts': checkShiftBalance,
    };
    const shiftRuleHandlers = { 'minStaff': checkMinStaff };
    const systemRuleHandlers = {
        'employeeAvailability': checkEmployeeAvailability,
        'duplicateAssignment': checkDuplicateAssignment,
    };

    // --- 公開的主要驗證函式 ---
    RuleEngine.validate = function(params) {
        const { currentDate, scheduleData, schedulingConditions, shiftTypes, calendarGrid, employeeAvailability, holidayDates } = params;
        console.log('開始三班制規則驗證...', { /* ... */ });
        clearValidationHighlights(calendarGrid);
        let totalConflicts = 0;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const context = { scheduleData, year, month, shiftTypes, calendarGrid, employeeAvailability, holidayDates };

        if (schedulingConditions.employeeRules) {
            schedulingConditions.employeeRules.forEach(rule => {
                if (employeeRuleHandlers[rule.type]) totalConflicts += employeeRuleHandlers[rule.type]({ ...context, rule });
            });
        }
        if (schedulingConditions.shiftRules) {
            schedulingConditions.shiftRules.forEach(rule => {
                if (shiftRuleHandlers[rule.type]) totalConflicts += shiftRuleHandlers[rule.type]({ ...context, rule });
            });
        }
        Object.values(systemRuleHandlers).forEach(handler => totalConflicts += handler(context));
        
        if (totalConflicts === 0) alert('🎉 太棒了！未發現任何排班衝突。');
        else alert(`⚠️ 發現 ${totalConflicts} 個排班衝突，請查看月曆上的紅色標記。`);
        return { totalConflicts, isValid: totalConflicts === 0 };
    };

    // --- 自動排班輔助函式 ---

    RuleEngine.selectEmployeesWithFairness = function(availableEmployees, shiftType, requiredCount, employeeStats, allEmployees, strategy, date) {
        if (availableEmployees.length <= requiredCount) return availableEmployees;
        let sortedEmployees = [...availableEmployees];
        switch (strategy) {
            case 'balanced':
                sortedEmployees.sort((a, b) => (employeeStats[a]?.totalShifts || 0) - (employeeStats[b]?.totalShifts || 0));
                break;
            case 'minimize_night':
                if (shiftType === 'night' || shiftType === 'weekend-night') {
                    sortedEmployees.sort((a, b) => (employeeStats[a]?.nightShifts || 0) - (employeeStats[b]?.nightShifts || 0) || (employeeStats[a]?.totalShifts || 0) - (employeeStats[b]?.totalShifts || 0));
                } else {
                    sortedEmployees.sort((a, b) => (employeeStats[a]?.totalShifts || 0) - (employeeStats[b]?.totalShifts || 0));
                }
                break;
            case 'rotate':
                sortedEmployees.sort();
                if (date) {
                    const dayIndex = new Date(date).getDate();
                    const rotationOffset = dayIndex % sortedEmployees.length;
                    sortedEmployees = [...sortedEmployees.slice(rotationOffset), ...sortedEmployees.slice(0, rotationOffset)];
                }
                break;
            default:
                sortedEmployees.sort((a, b) => (employeeStats[a]?.totalShifts || 0) - (employeeStats[b]?.totalShifts || 0));
        }
        return sortedEmployees.slice(0, requiredCount);
    };

    /**
     * @description Calculates the number of consecutive workdays for an employee *before* a given target date.
     * @fix This function now correctly starts counting from the day before the target date.
     */
    RuleEngine.calculateConsecutiveWorkDays = function(employee, targetDate, scheduleData) {
        let consecutive = 0;
        const checkDate = new Date(targetDate);
        checkDate.setDate(checkDate.getDate() - 1); // **FIX**: Start from the day BEFORE the target.

        // 檢查目標日期前的連續工作天
        for (let i = 0; i < 14; i++) { // Check up to 14 days back
            const checkDateStr = formatDate(checkDate);
            if ((scheduleData[checkDateStr] || []).some(s => s.employee === employee && s.shift !== 'off')) {
                consecutive++;
            } else {
                break; // Stop counting once a day off is found
            }
            checkDate.setDate(checkDate.getDate() - 1);
        }
        return consecutive;
    };

    RuleEngine.wouldCause24HourShift = function(employee, date, shiftType, scheduleData, holidayDates) {
        if (shiftType === 'off' || !(shiftType === 'day' || shiftType === 'weekend-day')) return false;
        
        const currentDate = new Date(date);
        const prevDate = new Date(currentDate);
        prevDate.setDate(prevDate.getDate() - 1);
        const prevDateStr = formatDate(prevDate);
        
        const prevShifts = scheduleData[prevDateStr] || [];
        const prevIsHoliday = isHoliday(prevDateStr, holidayDates);
        const nightShifts = prevIsHoliday ? ['weekend-night'] : ['night'];
        
        return prevShifts.some(s => s.employee === employee && nightShifts.includes(s.shift));
    };

    RuleEngine.wouldViolateShiftGap = function(employee, date, shiftType, scheduleData, holidayDates) {
        if (shiftType === 'off') return false;
        
        const currentDate = new Date(date);
        const prevDate = new Date(currentDate);
        prevDate.setDate(prevDate.getDate() - 1);
        const nextDate = new Date(currentDate);
        nextDate.setDate(nextDate.getDate() + 1);
        
        const prevDateStr = formatDate(prevDate);
        const nextDateStr = formatDate(nextDate);
        
        const prevShifts = scheduleData[prevDateStr] || [];
        const nextShifts = scheduleData[nextDateStr] || [];
        
        const currentIsHoliday = isHoliday(date, holidayDates);
        const prevIsHoliday = isHoliday(prevDateStr, holidayDates);
        const nextIsHoliday = isHoliday(nextDateStr, holidayDates);

        // 檢查與前一天的班次間隔
        const prevShift = prevShifts.find(s => s.employee === employee && s.shift !== 'off');
        if (prevShift && !hasEnoughShiftGap(prevShift.shift, shiftType, prevIsHoliday, currentIsHoliday)) {
            return true;
        }

        // 檢查與後一天的班次間隔
        const nextShift = nextShifts.find(s => s.employee === employee && s.shift !== 'off');
        if (nextShift && !hasEnoughShiftGap(shiftType, nextShift.shift, currentIsHoliday, nextIsHoliday)) {
            return true;
        }
        
        return false;
    };

    window.RuleEngine = RuleEngine;

})(window);
