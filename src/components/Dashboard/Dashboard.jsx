import React, { useEffect, useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Activity, DollarSign, Layers, Sun, Moon, AlertTriangle } from 'lucide-react';
import './Dashboard.css';

const formatCurrency = (value) => {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
};

const formatFullCurrency = (value) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
};

const Dashboard = () => {
    const [rawData, setRawData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedChain, setSelectedChain] = useState('ALL');
    const [activeTab, setActiveTab] = useState('Volume'); // 'Volume' or 'Fees'
    const [isDarkMode, setIsDarkMode] = useState(true);

    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.remove('light-mode');
        } else {
            document.documentElement.classList.add('light-mode');
        }
    }, [isDarkMode]);

    useEffect(() => {
        fetch('/uniswap_data.json')
            .then(res => res.json())
            .then(data => {
                setRawData(data);
                setLoading(false);
            })
            .catch(err => {
                console.error("Failed to load data", err);
                setLoading(false);
            });
    }, []);

    const processedData = useMemo(() => {
        if (!rawData || !rawData.chains) return null;

        const chainsToAggregate = selectedChain === 'ALL'
            ? Object.keys(rawData.chains)
            : [selectedChain];

        // Aggregate monthly data
        const monthlyAgg = {};

        chainsToAggregate.forEach(chainKey => {
            const history = rawData.chains[chainKey];
            history.forEach(item => {
                if (!monthlyAgg[item.date]) {
                    monthlyAgg[item.date] = { date: item.date, volume: 0, fees: 0 };
                }
                monthlyAgg[item.date].volume += item.volume;
                monthlyAgg[item.date].fees += item.fees;
            });
        });

        const history = Object.values(monthlyAgg).sort((a, b) => a.date.localeCompare(b.date));

        // Calculate Deltas
        const currentMonth = history[history.length - 1];
        const previousMonth = history[history.length - 2];

        let volumeDelta = 0;
        let feesDelta = 0;

        if (currentMonth && previousMonth && previousMonth.volume > 0) {
            volumeDelta = ((currentMonth.volume - previousMonth.volume) / previousMonth.volume) * 100;
        }
        if (currentMonth && previousMonth && previousMonth.fees > 0) {
            feesDelta = ((currentMonth.fees - previousMonth.fees) / previousMonth.fees) * 100;
        }

        return {
            currentVolume: currentMonth ? currentMonth.volume : 0,
            currentFees: currentMonth ? currentMonth.fees : 0,
            volumeDelta,
            feesDelta,
            history
        };
    }, [rawData, selectedChain]);

    if (loading) return <div className="loading">Loading Uniswap V4 Data...</div>;
    if (!rawData) return <div className="error">Failed to load data. Please run the fetcher script.</div>;

    const { currentVolume, currentFees, volumeDelta, feesDelta, history } = processedData || {};

    // Chart Data Preparation
    const chartData = history ? history.slice(-12).map(item => {
        const [year, month] = item.date.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1, 15);
        return {
            name: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
            value: activeTab === 'Volume' ? item.volume : item.fees,
            originalDate: item.date
        };
    }) : [];

    const availableChains = ['ALL', ...Object.keys(rawData.chains)];

    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <div className="header-top">
                    <div className="logo-area">
                        <div className="uniswap-badge">
                            <img
                                style={{ width: '32px', height: '32px' }}
                                src={isDarkMode ? "/uniswap_black.webp" : "/uniswap.png"}
                                alt="Uniswap V4"
                            />
                        </div>
                        <h1 className="h1-gradient">Uniswap V4 Analytics</h1>
                    </div>
                    <button className="theme-toggle" onClick={() => setIsDarkMode(!isDarkMode)}>
                        {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                </div>

                <div className="chain-selector">
                    {availableChains.map(chain => (
                        <button
                            key={chain}
                            className={`chain-btn ${selectedChain === chain ? 'active' : ''}`}
                            onClick={() => setSelectedChain(chain)}
                        >
                            {chain}
                        </button>
                    ))}
                </div>
            </header>

            <div className="kpi-grid">
                <Card
                    title="Monthly Volume"
                    value={currentVolume}
                    delta={volumeDelta}
                    icon={<Activity size={24} />}
                    isActive={activeTab === 'Volume'}
                    onClick={() => setActiveTab('Volume')}
                />
                <Card
                    title="Monthly Fees"
                    value={currentFees}
                    delta={feesDelta}
                    icon={<DollarSign size={24} />}
                    isActive={activeTab === 'Fees'}
                    onClick={() => setActiveTab('Fees')}
                />
            </div>

            <div className="chart-section glass-card">
                <div className="chart-header">
                    <div className="chart-tabs">
                        <button
                            className={`chart-tab ${activeTab === 'Volume' ? 'active' : ''}`}
                            onClick={() => setActiveTab('Volume')}
                        >
                            Volume
                        </button>
                        <button
                            className={`chart-tab ${activeTab === 'Fees' ? 'active' : ''}`}
                            onClick={() => setActiveTab('Fees')}
                        >
                            Fees
                        </button>
                    </div>

                    <div className="chart-legend">
                        <span className={`dot ${activeTab === 'Volume' ? 'volume-dot' : 'fees-dot'}`}></span>
                        {selectedChain} {activeTab}
                    </div>
                </div>

                <div className="chart-wrapper">
                    <ResponsiveContainer width="100%" height={300} >
                        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <XAxis
                                dataKey="name"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#98a1c0', fontSize: 12 }}
                                dy={10}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(val) => formatCurrency(val)}
                                tick={{ fill: '#98a1c0', fontSize: 12 }}
                            />
                            <Tooltip
                                cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
                                contentStyle={{ backgroundColor: '#161821', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                itemStyle={{ color: '#fff' }}
                                formatter={(value) => [formatFullCurrency(value), activeTab]}
                            />
                            <Bar
                                dataKey="value"
                                radius={[4, 4, 0, 0]}
                                barSize={30}
                                animationDuration={1000}

                            >
                                {chartData.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={activeTab === 'Volume' ? '#ff007a' : '#4c2db3'}
                                        fillOpacity={1}
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
            <p className="disclaimer">
                <AlertTriangle size={14} style={{ marginRight: '6px', verticalAlign: 'middle', display: 'inline-block' }} />
                Data provided by The Graph subgraphs. Accuracy depends on subgraph indexing status.
            </p>
        </div>
    );
};

const Card = ({ title, value, delta, icon, isActive, onClick }) => {
    const isPositive = delta >= 0;
    return (
        <div
            className={`kpi-card glass-card ${isActive ? 'active-card' : ''}`}
            onClick={onClick}
            style={{ cursor: 'pointer' }}
        >
            <div className="card-icon-wrapper">
                {icon}
            </div>
            <div className="card-content">
                <h3>{title}</h3>
                <div className="card-value">{formatCurrency(value)}</div>
                <div className={`card-delta ${isPositive ? 'positive' : 'negative'}`}>
                    {isPositive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                    <span>{Math.abs(delta).toFixed(2)}%</span>
                    <span className="delta-label">vs last month</span>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
